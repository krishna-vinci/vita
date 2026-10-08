import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Author, commitPaths, ensureRepo, log, undoLast, withRepoLock } from "./git.js";
import { PathEscapeError } from "./paths.js";

const execFileAsync = promisify(execFile);

async function rawGit(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [
    "-C",
    root,
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    ...args,
  ]);
  return stdout.trim();
}

describe("workspace git", () => {
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_CONFIG_COUNT", "2");
    vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "Vita Test");
    vi.stubEnv("GIT_CONFIG_KEY_1", "user.email");
    vi.stubEnv("GIT_CONFIG_VALUE_1", "test@vita.local");
    root = await mkdtemp(path.join(tmpdir(), "vita-git-"));
    await ensureRepo(root);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("initialises main without committing and appends the cache ignore idempotently", async () => {
    expect(await rawGit(root, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(await log(root, 10)).toEqual([]);
    expect(await undoLast(root, "user")).toBeNull();
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(".vita/\n");
    await writeFile(path.join(root, ".gitignore"), "# User rules\ncustom");
    await ensureRepo(root);
    await ensureRepo(root);
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe("# User rules\ncustom\n.vita/\n");
    expect(await log(root, 10)).toEqual([]);
  });

  it.each<Author>(["user", "importer", "writer", "checker", "editor", "researcher", "system"])(
    "commits with the %s author and returns null on no change",
    async (author) => {
      await writeFile(path.join(root, "outline.md"), "one\n");
      const sha = await commitPaths(root, ["outline.md"], "Update outline", author);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      const name = `Vita ${author[0]?.toUpperCase()}${author.slice(1)}`;
      expect(await rawGit(root, "log", "-1", "--format=%an|%ae|%cn|%ce")).toBe(
        `${name}|${author}@vita.local|${name}|${author}@vita.local`,
      );
      expect((await log(root, 1))[0]).toMatchObject({ sha, author, message: "Update outline" });
      expect((await log(root, 1))[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await commitPaths(root, ["outline.md"], "No change", author)).toBeNull();
      expect(await commitPaths(root, [], "No paths", author)).toBeNull();
      expect(await commitPaths(root, ["missing.md"], "Missing path", author)).toBeNull();
      expect(await log(root, 10)).toHaveLength(1);
    },
  );

  it("commits only requested literal paths, leaving unrelated staged and unstaged changes", async () => {
    for (const rel of ["outline.md", "projects.md", "literal[1].md", "literal1.md"]) {
      await writeFile(path.join(root, rel), "original\n");
    }
    await commitPaths(root, ["."], "Initial", "system");
    await writeFile(path.join(root, "outline.md"), "changed outline\n");
    await writeFile(path.join(root, "projects.md"), "staged unrelated\n");
    await writeFile(path.join(root, "literal[1].md"), "changed literal\n");
    await writeFile(path.join(root, "literal1.md"), "unstaged unrelated\n");
    await rawGit(root, "add", "projects.md");
    await commitPaths(root, ["outline.md", "literal[1].md"], "Scoped change", "editor");
    expect(await rawGit(root, "show", "--name-only", "--format=", "HEAD")).toBe("literal[1].md\noutline.md");
    expect(await rawGit(root, "diff", "--cached", "--name-only")).toBe("projects.md");
    expect(await rawGit(root, "diff", "--name-only")).toBe("literal1.md");
    expect(await log(root, 1)).toHaveLength(1);
    expect(await log(root, 0)).toEqual([]);
  });

  it("commits deletions, including paths the user already staged as deleted", async () => {
    await writeFile(path.join(root, "a.md"), "a\n");
    await writeFile(path.join(root, "b.md"), "b\n");
    await commitPaths(root, ["a.md", "b.md"], "Create", "system");
    await rm(path.join(root, "a.md"));
    await rawGit(root, "rm", "b.md");
    expect(await commitPaths(root, ["a.md", "b.md"], "Delete", "user")).toMatch(/^[0-9a-f]{40}$/);
    expect(await rawGit(root, "show", "--name-status", "--format=", "HEAD")).toBe("D\ta.md\nD\tb.md");
  });

  it("never commits cache files, including force-staged or previously tracked cache", async () => {
    await mkdir(path.join(root, ".vita"));
    await writeFile(path.join(root, ".vita/cache"), "cache\n");
    expect(await commitPaths(root, [".vita/", ".vita/cache"], "Cache only", "system")).toBeNull();
    await rawGit(root, "add", "-f", ".vita/cache");
    await rawGit(root, "commit", "-m", "External cache commit");
    await writeFile(path.join(root, ".vita/cache"), "changed cache\n");
    await writeFile(path.join(root, ".vita/other"), "force staged\n");
    await rawGit(root, "add", "-f", ".vita/cache", ".vita/other");
    await writeFile(path.join(root, "outline.md"), "safe\n");
    await commitPaths(root, ["."], "Only safe files", "writer");
    expect(await rawGit(root, "show", "--name-only", "--format=", "HEAD")).toBe(".gitignore\noutline.md");
    expect(await rawGit(root, "diff", "--cached", "--name-only")).toBe(".vita/cache\n.vita/other");
    await symlink(path.join(root, ".vita"), path.join(root, "cache-alias"));
    expect(await commitPaths(root, ["cache-alias/cache"], "Alias cache", "system")).toBeNull();
  });

  it("undo restores previous content with a new role-authored commit and preserves history", async () => {
    await writeFile(path.join(root, "outline.md"), "original\n");
    const first = await commitPaths(root, ["outline.md"], "Original", "system");
    await writeFile(path.join(root, "outline.md"), "changed\n");
    const second = await commitPaths(root, ["outline.md"], "Changed", "writer");
    const reverted = await undoLast(root, "user");
    expect(reverted).toMatch(/^[0-9a-f]{40}$/);
    expect(reverted).not.toBe(second);
    expect(await readFile(path.join(root, "outline.md"), "utf8")).toBe("original\n");
    const history = await log(root, 10);
    expect(history.map((entry) => entry.sha)).toEqual([reverted, second, first]);
    expect(history[0]).toMatchObject({ author: "user", message: 'Revert "Changed"' });
    expect(await rawGit(root, "rev-parse", "HEAD^")).toBe(second);
  });

  it("refuses undo over external edits without losing them or changing history", async () => {
    await writeFile(path.join(root, "outline.md"), "original\n");
    await commitPaths(root, ["outline.md"], "Original", "system");
    await writeFile(path.join(root, "outline.md"), "committed change\n");
    await commitPaths(root, ["outline.md"], "Changed", "writer");
    await writeFile(path.join(root, "outline.md"), "external edit\n");
    await expect(undoLast(root, "user")).rejects.toThrow("Cannot undo");
    expect(await readFile(path.join(root, "outline.md"), "utf8")).toBe("external edit\n");
    expect(await log(root, 10)).toHaveLength(2);
    await writeFile(path.join(root, "outline.md"), "committed change\n");
    expect(await undoLast(root, "user")).toMatch(/^[0-9a-f]{40}$/);
  });

  it("serialises concurrent scoped commits", async () => {
    await writeFile(path.join(root, "a.md"), "a\n");
    await writeFile(path.join(root, "b.md"), "b\n");
    const [first, second] = await Promise.all([
      commitPaths(root, ["a.md"], "First", "writer"),
      commitPaths(root, ["b.md"], "Second", "editor"),
    ]);
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    expect(second).toMatch(/^[0-9a-f]{40}$/);
    expect(await rawGit(root, "show", "--name-only", "--format=", first ?? "")).toBe("a.md");
    expect(await rawGit(root, "show", "--name-only", "--format=", second ?? "")).toBe("b.md");
    expect((await log(root, 10)).map((entry) => entry.message)).toEqual(["Second", "First"]);
  });

  it("repository locks share realpath aliases, remain FIFO, and recover after rejection", async () => {
    const alias = path.join(root, "self");
    await symlink(root, alias);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withRepoLock(root, async () => {
      order.push("first");
      await gate;
      throw new Error("failed operation");
    });
    const failure = expect(first).rejects.toThrow("failed operation");
    const second = withRepoLock(alias, async () => {
      order.push("second");
    });
    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release();
    await Promise.all([failure, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("rejects traversal and metadata paths before staging and ignores inherited git redirection", async () => {
    await writeFile(path.join(root, "outline.md"), "safe\n");
    await expect(commitPaths(root, ["../outside"], "Escape", "user")).rejects.toBeInstanceOf(PathEscapeError);
    await expect(commitPaths(root, [".git/config"], "Metadata", "user")).rejects.toBeInstanceOf(PathEscapeError);
    vi.stubEnv("GIT_DIR", path.join(root, "nonexistent-repo"));
    vi.stubEnv("GIT_WORK_TREE", path.join(root, "nonexistent-tree"));
    vi.stubEnv("GIT_INDEX_FILE", path.join(root, "wrong-index"));
    expect(await commitPaths(root, ["outline.md"], "Confined", "writer")).toMatch(/^[0-9a-f]{40}$/);
    expect((await log(root, 10)).map((entry) => entry.message)).toEqual(["Confined"]);
  });

  it("refuses to discover a parent repository for an uninitialised workspace", async () => {
    await writeFile(path.join(root, "outline.md"), "parent\n");
    await commitPaths(root, ["outline.md"], "Parent", "system");
    const child = path.join(root, "child");
    await mkdir(child);
    await writeFile(path.join(child, "outline.md"), "child\n");
    await expect(commitPaths(child, ["outline.md"], "Wrong repository", "writer")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(undoLast(child, "user")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await log(root, 10)).map((entry) => entry.message)).toEqual(["Parent"]);
    await ensureRepo(child);
    await commitPaths(child, ["outline.md"], "Child", "system");
    expect((await log(child, 10)).map((entry) => entry.message)).toEqual(["Child"]);
    expect((await log(root, 10)).map((entry) => entry.message)).toEqual(["Parent"]);
  });

  it("pins file operations to the workspace despite local core.worktree configuration", async () => {
    const redirected = path.join(root, "redirected");
    await mkdir(redirected);
    await writeFile(path.join(redirected, "outline.md"), "redirected\n");
    await writeFile(path.join(root, "outline.md"), "workspace\n");
    await rawGit(root, "config", "core.worktree", redirected);
    await commitPaths(root, ["outline.md"], "Workspace content", "writer");
    expect(await rawGit(root, "show", "HEAD:outline.md")).toBe("workspace");
    expect(await readFile(path.join(redirected, "outline.md"), "utf8")).toBe("redirected\n");
  });
});
