import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Resume, Slug, slugify, type TemplateMeta } from "@vita/shared";
import { stringify } from "yaml";
import type { WorkspaceHandle } from "../pipeline/types.js";
import {
  CompileError,
  checkRender,
  compileTex,
  loadRenderSources,
  loadTemplate,
  pdfText,
  renderStoredTex,
} from "../render/index.js";
import { commitPaths, readText, writeFileAtomic, writeTextAtomic } from "../workspace/index.js";
import { scanFiles, templateLocks, templatePath } from "./storage.js";
import { validateProposal } from "./validation.js";
import { TemplateError } from "./zip.js";

export const sourceHash = (source: string): string => createHash("sha256").update(source).digest("hex");
export async function editableTemplate(ws: WorkspaceHandle, id: string) {
  Slug.parse(id);
  await templatePath(ws.root, `templates/${id}/template.yaml`);
  await templatePath(ws.root, `templates/${id}/main.tex.njk`);
  const template = await loadTemplate([join(ws.root, "templates"), join(ws.bundledDir, "templates")], id).catch(
    (error) => {
      if (error instanceof Error && error.message.startsWith("Template not found:"))
        throw new TemplateError("template-not-found", error.message);
      throw error;
    },
  );
  const editable = template.dir === join(ws.root, "templates", id);
  await scanFiles(template.dir, "", true);
  const source = await readFile(join(template.dir, "main.tex.njk"), "utf8");
  return { id, meta: template.meta, source, hash: sourceHash(source), editable, dir: template.dir };
}
export function validateTemplateSource(meta: TemplateMeta, source: string): void {
  try {
    validateProposal({ id: meta.id, templateYaml: stringify(meta), mainTexNjk: source, notes: [] }, "");
  } catch (error) {
    if (error instanceof CompileError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const line = /Line (\d+)/.exec(message)?.[1] ?? "1";
    throw new TemplateError(
      "invalid-source",
      /main\.tex\.njk:\d+:/.test(message) ? message : `main.tex.njk:${line}: ${message}`,
    );
  }
}
export async function forkTemplate(ws: WorkspaceHandle, id: string, name: string) {
  const original = await editableTemplate(ws, id);
  const newId = Slug.parse(slugify(name));
  const target = await templatePath(ws.root, `templates/${newId}`);
  const release = await templateLocks.acquire(target, "fork");
  let stage: string | undefined;
  try {
    // A workspace copy must not shadow a bundled id.
    for (const root of [join(ws.root, "templates"), join(ws.bundledDir, "templates")]) {
      try {
        await readFile(join(root, newId, "template.yaml"));
        throw new TemplateError("template-exists", "Template id already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(await templatePath(ws.root, "templates"), { recursive: true });
    stage = await mkdtemp(join(await templatePath(ws.root, "templates"), ".fork-"));
    await copyTemplateAssets(original.dir, stage);
    await writeFile(join(stage, "template.yaml"), stringify({ ...original.meta, id: newId, name, forkedFrom: id }));
    await rename(stage, target);
    stage = undefined;
    const sha = await commitPaths(ws.root, [`templates/${newId}`], `Fork template ${id}`, "user");
    const { dir: _dir, ...view } = await editableTemplate(ws, newId);
    return { ...view, sha };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    release();
  }
}
export async function saveTemplateSource(ws: WorkspaceHandle, id: string, source: string, baseHash: string) {
  const release = await templateLocks.acquire(await templatePath(ws.root, `templates/${Slug.parse(id)}`), "source");
  try {
    const current = await editableTemplate(ws, id);
    if (!current.editable) throw new TemplateError("read-only", "Fork bundled templates before editing");
    if (current.hash !== baseHash) throw new TemplateError("stale-source", "Template changed. Reload before saving.");
    if (Buffer.byteLength(source) > 1_000_000)
      throw new TemplateError("invalid-source", "main.tex.njk:1: Source exceeds 1 MB");
    validateTemplateSource(current.meta, source);
    await writeTextAtomic(ws.root, `templates/${id}/main.tex.njk`, source);
    const sha = await commitPaths(ws.root, [`templates/${id}/main.tex.njk`], `Edit template ${id}`, "user");
    const { dir: _dir, ...view } = await editableTemplate(ws, id);
    return { ...view, sha };
  } finally {
    release();
  }
}
export async function sampleResume(): Promise<Resume> {
  return Resume.parse(JSON.parse(await readFile(new URL("./fixtures/sample-resume.json", import.meta.url), "utf8")));
}
export async function previewResume(ws: WorkspaceHandle, resumeId?: string): Promise<Resume> {
  for (const rel of resumeId
    ? [`resumes/${Slug.parse(resumeId)}/resume.json`, `applications/${resumeId}/resume.json`]
    : ["resumes/master/resume.json"]) {
    try {
      return Resume.parse(JSON.parse(await readText(ws.root, rel)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (resumeId) throw new TemplateError("resume-not-found", "Preview resume not found");
  return sampleResume();
}
async function copyTemplateAssets(from: string, to: string): Promise<void> {
  for (const name of await scanFiles(from, "", true)) {
    await mkdir(dirname(join(to, name)), { recursive: true });
    await writeFile(join(to, name), await readFile(join(from, name)));
  }
}
export async function previewTemplate(
  ws: WorkspaceHandle,
  id: string,
  resume: Resume,
  source?: string,
  fictional = false,
) {
  const template = await editableTemplate(ws, id);
  source ??= template.source;
  validateTemplateSource(template.meta, source);
  const dir = await mkdtemp(join(tmpdir(), "vita-design-preview-"));
  try {
    await copyTemplateAssets(template.dir, dir);
    await writeFile(join(dir, "main.tex.njk"), source);
    const { generated: tex } = await renderStoredTex(
      ws.root,
      resume,
      { dir, meta: template.meta },
      fictional ? {} : await loadRenderSources(ws.root),
      false,
      true,
    );
    const compiled = await compileTex({ tex, assetsDir: dir });
    const check = checkRender(resume, await pdfText(compiled.pdf));
    if (!check.ok) throw new CompileError("Preview failed text extraction check", JSON.stringify(check));
    const key = randomUUID();
    const rel = `.vita/template-previews/${key}.pdf`;
    await templatePath(ws.root, rel);
    await writeFileAtomic(ws.root, rel, compiled.pdf);
    return { previewUrl: `/api/templates/${key}/adopted.pdf`, log: compiled.log.slice(-4000) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
