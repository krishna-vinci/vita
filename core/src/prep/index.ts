import { JobAnalysis, type Prep, Resume, Slug } from "@vita/shared";
import { buildSystemPrompt, runRole, wrapUntrusted } from "../agent/index.js";
import { interviewerRole } from "../agent/roles.js";
import { loadContext } from "../pipeline/context.js";
import { withGenerationLock } from "../pipeline/lock.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, fileHash, readText, writeTextAtomic } from "../workspace/index.js";
import { checkPrep } from "./check.js";
import { renderPrepMarkdown } from "./markdown.js";

export async function generatePrep(ws: WorkspaceHandle, applicationId: string, deps: PipelineDeps): Promise<Prep> {
  Slug.parse(applicationId);
  return withGenerationLock(ws.root, async () => {
    deps.signal?.throwIfAborted();
    const prefix = `applications/${applicationId}`;
    const inputs = [
      "outline.md",
      "projects.md",
      `${prefix}/job.md`,
      `${prefix}/analysis.json`,
      `${prefix}/resume.json`,
    ];
    const outputs = [`${prefix}/prep.json`, `${prefix}/prep.md`];
    const expected = await Promise.all(
      [...inputs, ...outputs].map(async (rel) => [rel, await fileHash(ws.root, rel)] as const),
    );
    const [job, analysisText, resumeText] = await Promise.all([
      readText(ws.root, `${prefix}/job.md`),
      readText(ws.root, `${prefix}/analysis.json`),
      readText(ws.root, `${prefix}/resume.json`),
    ]);
    const analysis = JobAnalysis.parse(JSON.parse(analysisText));
    const resume = Resume.parse(JSON.parse(resumeText));
    const ctx = await loadContext(ws);
    try {
      deps.onProgress?.({ stage: "prep", message: "Preparing questions and evidence-backed stories." });
      const draft = await runRole({
        role: interviewerRole,
        root: ws.root,
        system: await buildSystemPrompt({
          role: interviewerRole,
          root: ws.root,
          bundledDir: ws.bundledDir,
          task: "Prepare an interview for the supplied application using only supplied job text and evidence.",
        }),
        task: [
          "Call submit_prep with questions, stories and gaps. Explain which requirement or resume line prompts each question. Every story action must cite existing claim IDs. Results need claim text or measured/counted metrics; otherwise use null. Gap honestAnswer must start with a plain No, then bridge to supported experience and a prospective learning plan. Company notes may use only job text and allowed URLs; no URLs are fetched in this task. Do not infer company facts from a URL or prior knowledge.",
          wrapUntrusted("job.md", job),
          wrapUntrusted("analysis.json", JSON.stringify(analysis)),
          wrapUntrusted("resume.json", JSON.stringify(resume)),
          wrapUntrusted("claims and evidence", JSON.stringify([...ctx.index.claims.values()])),
        ].join("\n\n"),
        tools: { root: ws.root, index: ctx.index, search: ctx.search, resume, analysis },
        runtime: deps.runtime,
        models: deps.models,
        modelOverride: deps.modelOverrides?.interviewer,
        signal: deps.signal,
        retry: deps.retry,
        onUsage: deps.onUsage,
      });
      const { prep, flags } = checkPrep(draft, ctx.index, analysis);
      deps.signal?.throwIfAborted();
      for (const [rel, hash] of expected)
        if ((await fileHash(ws.root, rel)) !== hash) throw new Error(`Workspace changed during generation: ${rel}`);
      await writeTextAtomic(ws.root, `${prefix}/prep.json`, `${JSON.stringify(prep, null, 2)}\n`);
      await writeTextAtomic(ws.root, `${prefix}/prep.md`, renderPrepMarkdown(prep, flags));
      await commitPaths(ws.root, outputs, `Generate interview prep: ${applicationId}`, "writer");
      deps.onProgress?.({ stage: "done", message: flags.join("; ") || "Interview preparation saved." });
      return prep;
    } finally {
      ctx.search.close();
    }
  });
}
