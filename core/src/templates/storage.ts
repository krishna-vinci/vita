import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Slug } from "@vita/shared";
import { FileLocks, readText, resolveInWorkspace, writeFileAtomic, writeTextAtomic } from "../workspace/index.js";
import { safeFilename, TemplateError, UPLOAD_LIMIT, unzip } from "./zip.js";

export interface UploadedTemplate {
  id: string;
  dir: string;
  mainFile: string;
  files: string[];
}
export const templateLocks = new FileLocks();
export function incoming(id: string): string {
  return `templates/.incoming/${Slug.parse(id)}`;
}
export function artifacts(id: string): string {
  return `.vita/template-uploads/${Slug.parse(id)}`;
}

// Unlike general workspace IO, uploads reject even symlinks that remain inside the workspace.
export async function templatePath(root: string, rel: string): Promise<string> {
  let current = root;
  for (const part of rel.split("/")) {
    if (!part || part === "." || part === "..") throw new TemplateError("invalid-entry", "Unsafe template path");
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new TemplateError("invalid-entry", "Template paths must not contain symlinks");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return resolveInWorkspace(root, rel);
}
export async function scanFiles(dir: string, prefix = ""): Promise<string[]> {
  if (!(await lstat(dir)).isDirectory())
    throw new TemplateError("invalid-entry", "Template must be a directory without symlinks");
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) files.push(...(await scanFiles(join(dir, entry.name), `${name}/`)));
    else if (entry.isFile()) files.push(safeFilename(name));
    else throw new TemplateError("invalid-entry", "Template assets must be regular files without symlinks");
  }
  if (files.length > 200) throw new TemplateError("invalid-entry", "Template has more than 200 files");
  return files.sort();
}
export async function receiveTemplateUpload(
  root: string,
  input: { filename: string; bytes: Uint8Array },
): Promise<UploadedTemplate> {
  if (input.bytes.length > UPLOAD_LIMIT) throw new TemplateError("upload-too-large", "Template exceeds 10 MB");
  if (/[\\/]/.test(input.filename)) throw new TemplateError("invalid-entry", "Upload filename must be a basename");
  let files: Map<string, Buffer>;
  if (/\.zip$/i.test(input.filename)) files = unzip(input.bytes);
  else if (/\.tex$/i.test(input.filename)) files = new Map([[safeFilename(input.filename), Buffer.from(input.bytes)]]);
  else throw new TemplateError("invalid-upload", "Upload must be .tex or .zip");
  const mains = [...files].filter(
    ([name, bytes]) =>
      /\.tex$/i.test(name) &&
      /\\documentclass\s*(?:\[[^\]]*\]\s*)?\{/.test(bytes.toString("utf8").replace(/(?<!\\)%[^\r\n]*/g, "")),
  );
  if (mains.length !== 1)
    throw new TemplateError("ambiguous-main", "Template must have exactly one .tex file with \\documentclass");
  const id = randomUUID();
  const dir = await templatePath(root, incoming(id));
  await mkdir(dir, { recursive: true });
  try {
    for (const [name, bytes] of files) {
      await templatePath(root, `${incoming(id)}/${name}`);
      await writeFileAtomic(root, `${incoming(id)}/${name}`, bytes);
    }
    const upload = { id, dir, mainFile: mains[0]?.[0] ?? "", files: [...files.keys()].sort() };
    await templatePath(root, `${artifacts(id)}/upload.json`);
    await writeTextAtomic(root, `${artifacts(id)}/upload.json`, JSON.stringify(upload));
    return upload;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
export async function loadUpload(root: string, id: string): Promise<UploadedTemplate> {
  const dir = await templatePath(root, incoming(id));
  await templatePath(root, `${artifacts(id)}/upload.json`);
  const manifest = JSON.parse(await readText(root, `${artifacts(id)}/upload.json`));
  const files = await scanFiles(dir);
  if (
    manifest.id !== id ||
    !files.includes(manifest.mainFile) ||
    JSON.stringify(files) !== JSON.stringify(manifest.files)
  )
    throw new TemplateError("invalid-upload", "Upload files changed");
  return { id, dir, mainFile: manifest.mainFile, files };
}
export async function discardTemplate(root: string, id: string): Promise<void> {
  const release = await templateLocks.acquire(await templatePath(root, incoming(id)), "discard");
  try {
    await loadUpload(root, id);
    await rm(await templatePath(root, incoming(id)), { recursive: true });
    await rm(await templatePath(root, artifacts(id)), { recursive: true, force: true });
  } finally {
    release();
  }
}
export async function readArtifact(root: string, id: string, name: "original.pdf" | "preview.pdf"): Promise<Buffer> {
  return readFile(await templatePath(root, `${artifacts(id)}/${name}`));
}
