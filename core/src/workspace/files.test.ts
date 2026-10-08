import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileHash, readText, writeTextAtomic } from "./files.js";
import { PathEscapeError } from "./paths.js";

describe("workspace files", () => {
  let temporary: string;
  let root: string;

  beforeEach(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "vita-files-"));
    root = path.join(temporary, "workspace");
    await mkdir(root);
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it("creates nested parents, reads UTF-8, hashes bytes and reports missing files", async () => {
    const rel = "new/deep/outline.md";
    const content = "# Example\nA résumé with evidence.\n";
    await expect(fileHash(root, rel)).resolves.toBeNull();
    await writeTextAtomic(root, rel, content);
    await expect(readText(root, rel)).resolves.toBe(content);
    await expect(fileHash(root, rel)).resolves.toBe(createHash("sha256").update(content).digest("hex"));
    await writeTextAtomic(root, rel, "updated\n");
    await expect(readText(root, rel)).resolves.toBe("updated\n");
    expect(await readdir(path.join(root, "new/deep"))).toEqual(["outline.md"]);
    const bytes = Buffer.from([0, 255, 128, 10]);
    await writeFile(path.join(root, "binary"), bytes);
    expect(await fileHash(root, "binary")).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("read, write and hash all reject escapes without modifying outside files", async () => {
    const outside = path.join(temporary, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.md"), "private\n");
    await symlink(outside, path.join(root, "escape"));
    for (const rel of ["../outside/secret.md", "escape/secret.md", "escape/new/deep.md"]) {
      await expect(readText(root, rel)).rejects.toBeInstanceOf(PathEscapeError);
      await expect(writeTextAtomic(root, rel, "changed\n")).rejects.toBeInstanceOf(PathEscapeError);
      await expect(fileHash(root, rel)).rejects.toBeInstanceOf(PathEscapeError);
    }
    expect(await readFile(path.join(outside, "secret.md"), "utf8")).toBe("private\n");
    expect(await readdir(outside)).toEqual(["secret.md"]);
  });

  it("serialises writes through internal aliases and exposes only complete contents", async () => {
    await writeTextAtomic(root, "outline.md", "initial\n");
    await symlink(path.join(root, "outline.md"), path.join(root, "alias.md"));
    const contents = ["A".repeat(128 * 1024), "B".repeat(128 * 1024), "C".repeat(128 * 1024)];
    const writes = contents.map((content, index) =>
      writeTextAtomic(root, index === 1 ? "alias.md" : "outline.md", content),
    );
    const complete = new Set(["initial\n", ...contents]);
    for (let index = 0; index < 20; index += 1) expect(complete.has(await readText(root, "outline.md"))).toBe(true);
    await Promise.all(writes);
    expect(await readText(root, "outline.md")).toBe(contents[2]);
    expect(await readText(root, "alias.md")).toBe(contents[2]);
    expect((await readdir(root)).sort()).toEqual(["alias.md", "outline.md"]);
  });

  it("cleans a temporary file and releases the write lock when rename fails", async () => {
    await mkdir(path.join(root, "target"));
    await expect(writeTextAtomic(root, "target", "cannot replace a directory")).rejects.toThrow();
    expect(await readdir(root)).toEqual(["target"]);
    await rm(path.join(root, "target"), { recursive: true });
    await writeTextAtomic(root, "target", "recovered\n");
    expect(await readText(root, "target")).toBe("recovered\n");
    await expect(fileHash(root, ".")).rejects.toThrow();
  });
});
