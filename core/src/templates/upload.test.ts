import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compileOriginal } from "./compile.js";
import { discardTemplate, loadUpload, receiveTemplateUpload } from "./storage.js";
import { zipFixture } from "./test-helpers.js";
import { UPLOAD_LIMIT } from "./zip.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-upload-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
it("receives tex and nested ZIP files, resolves one main document, and discards without commits", async () => {
  const upload = await receiveTemplateUpload(root, {
    filename: "cv.zip",
    bytes: zipFixture([{ name: "example/cv.tex" }, { name: "example/local.sty", text: "safe asset" }]),
  });
  expect(upload).toMatchObject({ mainFile: "example/cv.tex", files: ["example/cv.tex", "example/local.sty"] });
  expect(upload.dir).toBe(join(root, "templates/.incoming", upload.id));
  expect(await loadUpload(root, upload.id)).toEqual(upload);
  await discardTemplate(root, upload.id);
  await expect(loadUpload(root, upload.id)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    receiveTemplateUpload(root, { filename: "cv.tex", bytes: Buffer.from("sample with no documentclass") }),
  ).rejects.toMatchObject({ code: "ambiguous-main" });
  await expect(
    receiveTemplateUpload(root, { filename: "cv.zip", bytes: zipFixture([{ name: "a.tex" }, { name: "b.tex" }]) }),
  ).rejects.toMatchObject({ code: "ambiguous-main" });
});
it("rejects traversal, absolute paths, symlinks, directories, duplicates and unsupported ZIP entries before extraction", async () => {
  for (const name of [
    "../escape.tex",
    "/escape.tex",
    "C:/escape.tex",
    "nested/../../escape.tex",
    "nested\\escape.tex",
    "file.sh",
    "folder/",
  ]) {
    await expect(
      receiveTemplateUpload(root, { filename: "cv.zip", bytes: zipFixture([{ name }]) }),
    ).rejects.toMatchObject({ code: "invalid-entry" });
  }
  for (const mode of [0o120777, 0o040755, 0o010644])
    await expect(
      receiveTemplateUpload(root, { filename: "cv.zip", bytes: zipFixture([{ name: "cv.tex", mode }]) }),
    ).rejects.toMatchObject({ code: "invalid-entry" });
  await expect(
    receiveTemplateUpload(root, { filename: "cv.zip", bytes: zipFixture([{ name: "cv.tex" }, { name: "cv.tex" }]) }),
  ).rejects.toMatchObject({ code: "invalid-zip" });
  expect(await readdir(root)).toEqual([]);
});
it("caps compressed and expanded sizes and entry counts; rejects invalid ZIP data", async () => {
  for (const bytes of [Buffer.alloc(UPLOAD_LIMIT + 1), zipFixture([{ name: "cv.tex", expanded: UPLOAD_LIMIT + 1 }])]) {
    await expect(receiveTemplateUpload(root, { filename: "cv.zip", bytes })).rejects.toMatchObject({
      code: "upload-too-large",
    });
  }
  await expect(
    receiveTemplateUpload(root, {
      filename: "cv.zip",
      bytes: zipFixture(Array.from({ length: 201 }, (_, n) => ({ name: `${n}.tex` }))),
    }),
  ).rejects.toMatchObject({ code: "invalid-zip" });
  await expect(
    receiveTemplateUpload(root, { filename: "cv.zip", bytes: Buffer.from("not zip") }),
  ).rejects.toMatchObject({ code: "invalid-zip" });
});
it("prescans write18 and unsafe assets before any process and rejects filesystem symlinks", async () => {
  const upload = await receiveTemplateUpload(root, {
    filename: "cv.tex",
    bytes: Buffer.from("\\documentclass{article}\n\\write18{evil}"),
  });
  await expect(compileOriginal(upload)).rejects.toMatchObject({
    name: "CompileError",
    message: "Unsafe LaTeX input",
    log: expect.stringContaining("write"),
  });
  await writeFile(join(upload.dir, "local.sty"), "\\input{/etc/passwd}");
  await writeFile(join(upload.dir, "cv.tex"), "\\documentclass{article}");
  await expect(compileOriginal(upload)).rejects.toThrow("Unsafe LaTeX input");
  await rm(join(upload.dir, "local.sty"));
  await symlink(join(upload.dir, "cv.tex"), join(upload.dir, "link.sty"));
  await expect(compileOriginal(upload)).rejects.toThrow("symlink");
});
it("rejects an incoming directory symlink even when its target stays inside the workspace", async () => {
  const upload = await receiveTemplateUpload(root, {
    filename: "cv.tex",
    bytes: Buffer.from("\\documentclass{article}"),
  });
  await discardTemplate(root, upload.id);
  await symlink(root, join(root, "templates/.incoming", upload.id));
  await expect(loadUpload(root, upload.id)).rejects.toThrow("symlinks");
});
