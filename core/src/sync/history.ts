import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { promisify } from "node:util";
import { Resume } from "@vita/shared";
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

export async function generationHead(root: string): Promise<string | undefined> {
  try {
    return SourceSha.parse((await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"])).trim());
  } catch (error) {
    if ((error as { code?: number }).code === 1) return undefined;
    throw error;
  }
}

export async function resumeBaseline(root: string, id: string): Promise<string> {
  // Suggestions must retain changes made before subsequent local resume edits.
  return SourceSha.parse(await generationBaseline(root, `resumes/${id}`, true));
}

export async function generationBaseline(
  root: string,
  prefix: string,
  firstSeenFallback = false,
): Promise<string | undefined> {
  resolveInWorkspace(root, prefix);
  if (!(await generationHead(root))) return undefined;
  const history = (await git(root, ["log", "--format=%H%x00%s", "--", `${prefix}/resume.json`, `${prefix}/meta.yaml`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const generated = history.find((entry) =>
    /^(?:Generate (?:master|base|job) resume: |Rerun .* with answers$)/.test(entry.split("\0")[1] ?? ""),
  );
  return (generated ?? (firstSeenFallback ? history.at(-1) : history[0]))?.split("\0")[0];
}

export async function sourceWorkingChanges(root: string): Promise<boolean> {
  return !!(await git(root, ["status", "--porcelain", "--", "outline.md", "projects.md"])).trim();
}

export async function sourceHistory(root: string) {
  if (!(await generationHead(root))) return [];
  const entries = (await git(root, ["log", "--format=%H%x00%cI", "--", "outline.md", "projects.md"]))
    .trim()
    .split("\n")
    .filter(Boolean);
  return entries.map((entry) => {
    const [sha = "", at = ""] = entry.split("\0");
    return { sha: SourceSha.parse(sha), at };
  });
}

export async function changedSince(root: string, sha: string, file: string): Promise<boolean> {
  SourceSha.parse(sha);
  resolveInWorkspace(root, file);
  return (
    !!(await git(root, ["log", "-1", "--format=%H", `${sha}..HEAD`, "--", file])).trim() ||
    !!(await git(root, ["status", "--porcelain", "--", file])).trim()
  );
}

export async function isAfter(root: string, sha: string, baseline: string): Promise<boolean> {
  SourceSha.parse(sha);
  SourceSha.parse(baseline);
  if (sha === baseline) return false;
  try {
    await git(root, ["merge-base", "--is-ancestor", sha, baseline]);
    return false;
  } catch {
    return true;
  }
}

/** Locate the edit commit as well as its time (Git timestamps only have second precision). */
export async function bulletEditCommits(root: string, prefix: string): Promise<Map<string, string>> {
  resolveInWorkspace(root, prefix);
  const result = new Map<string, string>();
  if (!(await generationHead(root))) return result;
  const history = (await git(root, ["log", "--reverse", "--format=%H", "--", `${prefix}/resume.json`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const sha of history) {
    const entry = await git(root, ["ls-tree", sha, "--", `${prefix}/resume.json`]);
    if (!entry) continue;
    if (!/^100(?:644|755) /.test(entry)) throw new Error("Resume history is not a regular file");
    const resume = Resume.safeParse(JSON.parse(await git(root, ["show", `${sha}:${prefix}/resume.json`])));
    if (!resume.success) continue;
    for (const section of resume.data.sections)
      for (const item of section.items)
        for (const bullet of item.bullets)
          for (const at of [bullet.lockedAt, bullet.editedAt])
            if (at && !result.has(`${bullet.id}:${at}`)) result.set(`${bullet.id}:${at}`, sha);
  }
  return result;
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
