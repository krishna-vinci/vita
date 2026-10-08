import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  checkRender,
  compileTex,
  loadTemplate,
  pdfText,
  readText,
  renderMarkdown,
  renderTex,
  resolveInWorkspace,
  writeTextAtomic,
} from "@vita/core";
import { type RenderCheck, Resume, Slug } from "@vita/shared";
import { bundledTemplatesDir } from "../paths";

export async function renderCommand(dir: string, opts: { resume?: string; out?: string } = {}): Promise<RenderCheck> {
  const root = resolve(dir);
  const id = Slug.parse(opts.resume ?? "master");
  const resume = Resume.parse(JSON.parse(await readText(root, `resumes/${id}/resume.json`)));
  const tpl = await loadTemplate([resolveInWorkspace(root, "templates"), bundledTemplatesDir], resume.template);
  const tex = renderTex(resume, tpl);
  const { pdf } = await compileTex({ tex, assetsDir: tpl.dir });
  const check = checkRender(resume, await pdfText(pdf), 1);
  const outputRoot = opts.out ? resolve(opts.out) : root;
  const prefix = opts.out ? "" : `resumes/${id}/`;
  await mkdir(outputRoot, { recursive: true });
  for (const file of ["resume.tex", "resume.pdf", "resume.md"]) resolveInWorkspace(outputRoot, prefix + file);
  await writeTextAtomic(outputRoot, `${prefix}resume.tex`, tex);
  await writeFile(resolveInWorkspace(outputRoot, `${prefix}resume.pdf`), pdf);
  await writeTextAtomic(outputRoot, `${prefix}resume.md`, renderMarkdown(resume));
  console.log(JSON.stringify(check, null, 2));
  return check;
}
