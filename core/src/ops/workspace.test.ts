import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Resume } from "@vita/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitPaths, ensureRepo, log, PathEscapeError, readText, writeTextAtomic } from "../workspace/index.js";
import { applyResumeOps } from "./index.js";
import { context, sampleResume } from "./test-fixtures.js";

const execFileAsync = promisify(execFile);
const resumePath = "resumes/master/resume.json";

describe("applyResumeOps", () => {
  let sandbox: string;
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    sandbox = await mkdtemp(path.join(tmpdir(), "vita-ops-"));
    root = path.join(sandbox, "workspace");
    await mkdir(root);
    await ensureRepo(root);
    await writeTextAtomic(root, resumePath, `${JSON.stringify(sampleResume(), null, 2)}\n`);
    await writeTextAtomic(root, "outline.md", "Original source.\n");
    await commitPaths(root, [resumePath, "outline.md"], "Initial", "system");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(sandbox, { recursive: true, force: true });
  });

  it("persists a validated resume and commits only that file with the requested author", async () => {
    await writeTextAtomic(root, "outline.md", "Unrelated edit.\n");
    const result = await applyResumeOps(
      root,
      resumePath,
      [{ op: "bullet.edit", id: "one", text: "User revision." }],
      context(),
      "user",
    );
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.changedBullets).toEqual(["one"]);
    expect(Resume.parse(JSON.parse(await readText(root, resumePath)))).toEqual(result.resume);
    const { stdout } = await execFileAsync("git", ["-C", root, "show", "--name-only", "--format=", result.sha ?? ""]);
    expect(stdout.trim()).toBe(resumePath);
    expect((await log(root, 2))[0]).toMatchObject({ sha: result.sha, author: "user", message: "Apply resume edits" });
    expect(await readText(root, "outline.md")).toBe("Unrelated edit.\n");
    const unchanged = await applyResumeOps(root, resumePath, [], context(), "user");
    expect(unchanged.sha).toBeNull();
    expect(unchanged.changedBullets).toEqual([]);
    expect(await log(root, 10)).toHaveLength(2);
  });

  it("leaves file bytes and history unchanged on invalid batches and final schema failure", async () => {
    const before = await readText(root, resumePath);
    const history = await log(root, 10);
    await expect(
      applyResumeOps(
        root,
        resumePath,
        [
          { op: "bullet.edit", id: "one", text: "First op." },
          { op: "bullet.hide", id: "missing", hidden: true },
        ],
        context(),
        "user",
      ),
    ).rejects.toMatchObject({ code: "unknown-id" });
    const invalidContext = context();
    invalidContext.now = () => 123 as unknown as string;
    await expect(
      applyResumeOps(
        root,
        resumePath,
        [{ op: "bullet.override", id: "one", reason: "user-attested" }],
        invalidContext,
        "user",
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await readText(root, resumePath)).toBe(before);
    expect(await log(root, 10)).toEqual(history);
    // A failed batch releases its lock so the next valid edit can proceed.
    expect(
      (
        await applyResumeOps(
          root,
          resumePath,
          [{ op: "bullet.edit", id: "one", text: "Valid next edit." }],
          context(),
          "user",
        )
      ).sha,
    ).toMatch(/^[0-9a-f]{40}$/);
  });

  it("serialises concurrent read/apply/write/commit batches without losing edits", async () => {
    const [first, second] = await Promise.all([
      applyResumeOps(root, resumePath, [{ op: "bullet.edit", id: "one", text: "First edit." }], context(), "user"),
      applyResumeOps(root, resumePath, [{ op: "bullet.edit", id: "two", text: "Second edit." }], context(), "user"),
    ]);
    expect(first.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(second.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.sha).not.toBe(second.sha);
    const saved = Resume.parse(JSON.parse(await readText(root, resumePath)));
    expect(saved.sections[0]?.items[0]?.bullets.map((bullet) => bullet.text)).toEqual(["First edit.", "Second edit."]);
    expect((await log(root, 3)).map((entry) => entry.sha).slice(0, 2)).toEqual([second.sha, first.sha]);
  });

  it("commits the canonical resume file when addressed through an internal symlink", async () => {
    await symlink(path.join(root, resumePath), path.join(root, "resume-alias.json"));
    const result = await applyResumeOps(
      root,
      "resume-alias.json",
      [{ op: "bullet.edit", id: "one", text: "Through an alias." }],
      context(),
      "editor",
    );
    const { stdout } = await execFileAsync("git", ["-C", root, "show", "--name-only", "--format=", result.sha ?? ""]);
    expect(stdout.trim()).toBe(resumePath);
    expect(Resume.parse(JSON.parse(await readText(root, resumePath)))).toEqual(result.resume);
  });

  it("rejects traversal and symlink escape before reading or writing", async () => {
    const outside = "outside.json";
    await writeTextAtomic(sandbox, outside, `${JSON.stringify(sampleResume())}\n`);
    await symlink(path.join(sandbox, outside), path.join(root, "escape.json"));
    const before = await readText(sandbox, outside);
    for (const rel of ["../outside.json", "escape.json"]) {
      await expect(
        applyResumeOps(root, rel, [{ op: "bullet.edit", id: "one", text: "Escape." }], context(), "user"),
      ).rejects.toBeInstanceOf(PathEscapeError);
    }
    expect(await readText(sandbox, outside)).toBe(before);
    expect(await log(root, 10)).toHaveLength(1);
  });
});
