import { stringify as stringifyYaml } from "yaml";
import { commitPaths, fileHash, writeFileAtomic, writeTextAtomic } from "../workspace/index.js";
import { localDate } from "./date.js";
import type { generate } from "./generate.js";
import type { PipelineDeps, RoleUsage, WorkspaceHandle } from "./types.js";

export async function persist(
  ws: WorkspaceHandle,
  prefix: string,
  result: Awaited<ReturnType<typeof generate>>,
  deps: PipelineDeps,
  usage: RoleUsage[],
  extra: Record<string, string>,
  expected: string | null,
  metadata: Record<string, unknown> = {},
  message?: string,
) {
  deps.signal?.throwIfAborted();
  if ((await fileHash(ws.root, `${prefix}/resume.json`)) !== expected)
    throw new Error(`Workspace changed during generation: ${prefix}/resume.json`);
  deps.onProgress?.({ stage: "save", round: result.review.round });
  const output = prefix.startsWith("applications/") ? `${prefix}/out` : prefix;
  const files: Record<string, string | Uint8Array> = {
    ...extra,
    [`${prefix}/resume.json`]: `${JSON.stringify(result.resume, null, 2)}\n`,
    [`${prefix}/review.json`]: `${JSON.stringify(result.review, null, 2)}\n`,
    [`${prefix}/meta.yaml`]: stringifyYaml({
      ...metadata,
      id: result.resume.id,
      kind: result.resume.kind,
      parent: result.resume.parent,
      createdAt: metadata.createdAt ?? localDate((deps.now ?? (() => new Date()))()),
      usage,
      generatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      warnings: result.warnings,
    }),
    [`${output}/resume.tex`]: result.tex,
    [`${output}/resume.md`]: result.markdown,
    ...(result.pdf ? { [`${output}/resume.pdf`]: result.pdf } : {}),
  };
  for (const [rel, content] of Object.entries(files)) {
    if (typeof content === "string") await writeTextAtomic(ws.root, rel, content);
    else await writeFileAtomic(ws.root, rel, content);
  }
  deps.signal?.throwIfAborted();
  await commitPaths(
    ws.root,
    Object.keys(files),
    message ?? `Generate ${result.resume.kind} resume: ${result.resume.id}`,
    "writer",
  );
  deps.onProgress?.({
    stage: "done",
    round: result.review.round,
    message: result.review.done ? "Done criteria passed." : result.review.blocking.join("; "),
  });
}
