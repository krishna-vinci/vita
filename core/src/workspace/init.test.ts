import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { log } from "./git.js";
import { initWorkspace } from "./init.js";
import { PathEscapeError } from "./paths.js";

describe("initWorkspace", () => {
  let temporary: string;
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    vi.stubEnv("GIT_CONFIG_COUNT", "2");
    vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "Vita Test");
    vi.stubEnv("GIT_CONFIG_KEY_1", "user.email");
    vi.stubEnv("GIT_CONFIG_VALUE_1", "test@vita.local");
    temporary = await mkdtemp(path.join(tmpdir(), "vita-init-"));
    root = path.join(temporary, "new/workspace");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(temporary, { recursive: true, force: true });
  });

  it("creates the starter files and directories with exactly one system commit", async () => {
    await initWorkspace(root, { name: "Alex Example" });
    const outline = await readFile(path.join(root, "outline.md"), "utf8");
    expect(outline).toContain("# Alex Example\n");
    expect(outline.match(/^## .+$/gm)).toEqual([
      "## Summary",
      "## Experience",
      "## Projects",
      "## Education",
      "## Skills",
    ]);
    expect(outline.match(/<!-- .+ -->/g)).toHaveLength(5);
    expect(outline).not.toMatch(/^- /m);
    expect(await readFile(path.join(root, "projects.md"), "utf8")).toMatch(
      /^# Projects and evidence\n\n<!-- .+ -->\n$/,
    );
    for (const rel of ["resumes/master", "applications", "packs", "templates", "config"]) {
      expect((await stat(path.join(root, rel))).isDirectory()).toBe(true);
    }
    expect(parse(await readFile(path.join(root, "config/models.yaml"), "utf8"))).toEqual({
      default: "anthropic/claude-sonnet-5-5",
      roles: {},
    });
    expect(parse(await readFile(path.join(root, "config/rules.yaml"), "utf8"))).toEqual({ max_pages: 1 });
    expect(parse(await readFile(path.join(root, "config/vita.yaml"), "utf8"))).toEqual({ version: 1 });
    expect(await readFile(path.join(root, ".gitignore"), "utf8")).toBe(".vita/\n");
    const commits = await log(root, 10);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ author: "system", message: "Initialise workspace" });
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("refuses a second run without modifying user content or creating another commit", async () => {
    await initWorkspace(root, { name: "Alex Example" });
    await writeFile(path.join(root, "outline.md"), "# Custom outline\n");
    await writeFile(path.join(root, "config/models.yaml"), "default: custom/model\n");
    await expect(initWorkspace(root, { name: "Replacement" })).rejects.toThrow("already has outline.md");
    expect(await readFile(path.join(root, "outline.md"), "utf8")).toBe("# Custom outline\n");
    expect(await readFile(path.join(root, "config/models.yaml"), "utf8")).toBe("default: custom/model\n");
    expect(await log(root, 10)).toHaveLength(1);
  });

  it("refuses a pre-existing outline before creating other files", async () => {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "outline.md"), "existing\n");
    await expect(initWorkspace(root, { name: "Alex Example" })).rejects.toThrow("already has outline.md");
    expect(await readdir(root)).toEqual(["outline.md"]);
  });

  it("rejects escaping skeleton symlinks without writing outside the workspace", async () => {
    await mkdir(root, { recursive: true });
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(root, "config"));
    await expect(initWorkspace(root, { name: "Alex Example" })).rejects.toBeInstanceOf(PathEscapeError);
    expect(await readdir(outside)).toEqual([]);
  });
});
