import { execFile } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { readText, writeTextAtomic } from "./files.js";
import { PathEscapeError, relFromRoot, resolveInWorkspace } from "./paths.js";

export type Author = "user" | "importer" | "writer" | "checker" | "editor" | "researcher" | "system";

const execFileAsync = promisify(execFile);
const repoLocks = new Map<string, Promise<void>>();
const authors: Author[] = ["user", "importer", "writer", "checker", "editor", "researcher", "system"];

function authorEnv(author: Author): Record<string, string> {
  const name = `Vita ${author[0]?.toUpperCase()}${author.slice(1)}`;
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${author}@vita.local`,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: `${author}@vita.local`,
  };
}

export function withRepoLock<T>(root: string, op: () => Promise<T>): Promise<T> {
  let key: string;
  try {
    key = realpathSync(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    key = path.resolve(root);
  }
  const previous = repoLocks.get(key) ?? Promise.resolve();
  const result = previous.then(op);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  repoLocks.set(key, tail);
  void tail.then(() => {
    if (repoLocks.get(key) === tail) repoLocks.delete(key);
  });
  return result;
}

async function git(root: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const workspace = realpathSync(root);
  // Git otherwise searches ancestors when this directory has no repository of its own.
  if (args[0] !== "init") lstatSync(resolveInWorkspace(workspace, ".git"));
  const baseEnv = { ...process.env };
  // Inherited repository overrides must not redirect a workspace operation elsewhere.
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ]) {
    delete baseEnv[key];
  }
  const { stdout } = await execFileAsync(
    "git",
    [
      "-C",
      workspace,
      ...(args[0] === "init" ? [] : [`--work-tree=${workspace}`]),
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env: { ...baseEnv, ...env }, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout;
}

async function hasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 1) return false;
    throw error;
  }
}

export async function ensureRepo(root: string): Promise<void> {
  await withRepoLock(root, async () => {
    await mkdir(root, { recursive: true });
    const metadata = resolveInWorkspace(root, ".git");
    try {
      lstatSync(metadata);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await git(root, ["init", "-b", "main"]);
    }
    let ignores = "";
    try {
      ignores = await readText(root, ".gitignore");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!ignores.split(/\r?\n/).includes(".vita/")) {
      const separator = ignores === "" || ignores.endsWith("\n") ? "" : "\n";
      await writeTextAtomic(root, ".gitignore", `${ignores}${separator}.vita/\n`);
    }
  });
}

function isCache(rel: string): boolean {
  return rel.split(path.sep).includes(".vita");
}

export async function commitPaths(
  root: string,
  paths: string[],
  message: string,
  author: Author,
): Promise<string | null> {
  return withRepoLock(root, () => commitPathsUnlocked(root, paths, message, author));
}

async function commitPathsUnlocked(
  root: string,
  paths: string[],
  message: string,
  author: Author,
): Promise<string | null> {
  const requested = paths.filter((rel) => {
    const canonical = relFromRoot(root, resolveInWorkspace(root, rel));
    const lexical = path.relative(path.resolve(root), path.resolve(root, rel));
    if (lexical.split(path.sep).includes(".git") || canonical.split(path.sep).includes(".git")) {
      throw new PathEscapeError(`Cannot commit repository metadata: ${rel}`);
    }
    return !isCache(lexical) && !isCache(canonical);
  });
  if (requested.length === 0) return null;

  // Expand directories into literal files so even tracked or force-staged cache files stay excluded.
  const candidates = await git(root, [
    "--literal-pathspecs",
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    ...requested,
  ]);
  const staged = await git(root, [
    "--literal-pathspecs",
    "diff",
    "--cached",
    "--name-only",
    "--no-renames",
    "-z",
    "--",
    ...requested,
  ]);
  const allowed = (rel: string) =>
    rel !== "" && !isCache(rel) && !isCache(relFromRoot(root, resolveInWorkspace(root, rel)));
  const toStage = [...new Set(candidates.split("\0").filter(allowed))];
  const selected = [...new Set([...toStage, ...staged.split("\0").filter(allowed)])];
  if (selected.length === 0) return null;
  if (toStage.length > 0) await git(root, ["--literal-pathspecs", "add", "-A", "--", ...toStage]);
  const changed = await git(root, ["--literal-pathspecs", "diff", "--cached", "--name-only", "-z", "--", ...selected]);
  if (changed === "") return null;
  // The pathspec also excludes unrelated changes already staged by the user.
  await git(root, ["--literal-pathspecs", "commit", "--only", "-m", message, "--", ...selected], authorEnv(author));
  return (await git(root, ["rev-parse", "HEAD"])).trim();
}

/**
 * The newest change to these paths that has not been undone yet. An "Undo: ..." commit cancels the live change
 * just before it, so repeated undo walks back one change at a time instead of toggling between two states.
 */
async function lastLiveChange(root: string, paths: string[], stopAt: Author[]): Promise<string> {
  const out = await git(root, [
    "--literal-pathspecs",
    "log",
    "-z",
    "-n500",
    "--format=%H%x00%s%x00%an",
    "--",
    ...paths,
  ]);
  const fields = out.split("\0");
  let cancelled = 0;
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const sha = (fields[i] ?? "").trim();
    const subject = fields[i + 1] ?? "";
    const name = fields[i + 2] ?? "";
    if (subject.startsWith("Undo: ")) cancelled++;
    else if (cancelled > 0) cancelled--;
    else return stopAt.some((author) => authorEnv(author).GIT_AUTHOR_NAME === name) ? "" : sha;
  }
  return "";
}

/** Restore a resource's last batch while preserving later edits to other resources. */
export async function undoPaths(
  root: string,
  paths: string[],
  author: Author,
  /** Changes by these authors are never undone (for example, the generated first version of a resume). */
  stopAt: Author[] = [],
): Promise<string | null> {
  return withRepoLock(root, async () => {
    for (const rel of paths) {
      const canonical = relFromRoot(root, resolveInWorkspace(root, rel));
      if ([rel, canonical].some((value) => value.split(path.sep).some((part) => part === ".git" || part === ".vita")))
        throw new PathEscapeError(`Cannot undo repository metadata or cache: ${rel}`);
    }
    if (!paths.length || !(await hasCommits(root))) return null;
    const sha = await lastLiveChange(root, paths, stopAt);
    if (!sha) return null;
    const dirty = await git(root, ["--literal-pathspecs", "status", "--porcelain", "--", ...paths]);
    if (dirty) throw new Error("Cannot undo over uncommitted resource edits");
    const subject = (await git(root, ["show", "-s", "--format=%s", sha])).trim();
    const parents = (await git(root, ["show", "-s", "--format=%P", sha])).trim().split(" ").filter(Boolean);
    const parent = parents[0];
    const previous = parent
      ? (await git(root, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", parent, "--", ...paths]))
          .split("\0")
          .filter(Boolean)
      : [];
    const current = (await git(root, ["--literal-pathspecs", "ls-files", "-z", "--", ...paths]))
      .split("\0")
      .filter(Boolean);
    for (const rel of [...previous, ...current]) {
      resolveInWorkspace(root, rel);
      if (rel.split("/").some((part) => part === ".git" || part === ".vita"))
        throw new PathEscapeError(`Cannot undo repository metadata or cache: ${rel}`);
    }
    const removed = current.filter((rel) => !previous.includes(rel));
    if (removed.length) await git(root, ["--literal-pathspecs", "rm", "--", ...removed]);
    if (parent && previous.length) await git(root, ["--literal-pathspecs", "checkout", parent, "--", ...previous]);
    return commitPathsUnlocked(root, paths, `Undo: ${subject}`, author);
  });
}

export async function undoLast(root: string, author: Author): Promise<string | null> {
  return withRepoLock(root, async () => {
    if (!(await hasCommits(root))) return null;
    try {
      await git(root, ["revert", "--no-edit", "HEAD"], authorEnv(author));
    } catch (cause) {
      await git(root, ["revert", "--abort"]).catch(() => undefined);
      throw new Error("Cannot undo the last workspace change", { cause });
    }
    return (await git(root, ["rev-parse", "HEAD"])).trim();
  });
}

export async function log(
  root: string,
  limit: number,
): Promise<{ sha: string; author: string; message: string; at: string }[]> {
  if (!Number.isInteger(limit) || limit < 0) throw new Error("Log limit must be a non-negative integer");
  if (limit === 0 || !(await hasCommits(root))) return [];
  const output = await git(root, ["log", `-n${limit}`, "--format=%H%x00%an%x00%s%x00%aI", "-z"]);
  const fields = output.split("\0");
  const result: { sha: string; author: string; message: string; at: string }[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [sha, name, message, at] = fields.slice(index, index + 4) as [string, string, string, string];
    const role = authors.find((author) => authorEnv(author).GIT_AUTHOR_NAME === name);
    result.push({ sha, author: role ?? name, message, at });
  }
  return result;
}
