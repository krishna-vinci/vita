import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import { z } from "zod";
import { buildClaimIndex } from "../claims/index.js";
import { assignOutlineAnchors, parseOutline, parseProjects } from "../source/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import { SyncConflictError } from "./errors.js";

export const SourceSha = z.string().regex(/^[a-f0-9]{40}$/);
const exec = promisify(execFile);

// Read only this workspace's history, even when Git overrides are inherited.
async function git(root: string, args: string[]): Promise<string> {
  const workspace = realpathSync(root);
  resolveInWorkspace(workspace, ".git");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  const { stdout } = await exec(
    "git",
    [
      "-C",
      workspace,
      `--git-dir=${resolveInWorkspace(workspace, ".git")}`,
      `--work-tree=${workspace}`,
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}

export async function headSha(root: string): Promise<string> {
  return SourceSha.parse((await git(root, ["rev-parse", "--verify", "HEAD"])).trim());
}

export async function resumeBaseline(root: string, id: string): Promise<string> {
  const history = (await git(root, ["log", "--format=%H%x00%s", "--", `resumes/${id}/resume.json`])).trim().split("\n");
  const generated = history.find((entry) => /^Generate (?:master|base) resume: /.test(entry.split("\0")[1] ?? ""));
  return SourceSha.parse((generated ?? history.at(-1) ?? "").split("\0")[0]);
}

export async function sourceAt(root: string, sha: string) {
  SourceSha.parse(sha);
  // Verify ancestry as well as existence: an unrelated history is not a sync baseline.
  try {
    await git(root, ["merge-base", "--is-ancestor", sha, "HEAD"]);
  } catch {
    throw new SyncConflictError("invalid-history", "The sync baseline must be an existing ancestor of HEAD.");
  }
  const files: Record<string, string> = {};
  for (const file of ["outline.md", "projects.md"]) {
    const entry = await git(root, ["ls-tree", sha, "--", file]);
    if (entry && !entry.startsWith("100644 ") && !entry.startsWith("100755 "))
      throw new Error(`Source is not a regular file: ${file}`);
    files[file] = entry ? await git(root, ["show", `${sha}:${file}`]) : "";
  }
  return {
    files,
    index: buildClaimIndex(
      parseProjects(files["projects.md"] ?? "").doc,
      parseOutline(assignOutlineAnchors(files["outline.md"] ?? "").markdown),
    ),
    outline: parseOutline(assignOutlineAnchors(files["outline.md"] ?? "").markdown),
  };
}
