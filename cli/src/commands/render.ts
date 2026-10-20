import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  checkRender,
  compileTex,
  loadRenderSources,
  loadTemplate,
  pdfText,
  readText,
  renderMarkdown,
  renderTex,
  resolveInWorkspace,
  writeTextAtomic,
} from "@vita/core";
import { BaseConfig, type RenderCheck, Resume, Slug } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { bundledTemplatesDir } from "../paths";

export async function renderCommand(dir: string, opts: { resume?: string; out?: string } = {}): Promise<RenderCheck> {
  const root = resolve(dir);
  const id = Slug.parse(opts.resume ?? "master");
  const resume = Resume.parse(JSON.parse(await readText(root, `resumes/${id}/resume.json`)));
  const tpl = await loadTemplate([resolveInWorkspace(root, "templates"), bundledTemplatesDir], resume.template);
  const sources = await loadRenderSources(root);
  const tex = renderTex(resume, tpl, sources);
  const { pdf } = await compileTex({ tex, assetsDir: tpl.dir });
  const check = checkRender(resume, await pdfText(pdf), await pageLimit(root, id, resume));
  const outputRoot = opts.out ? resolve(opts.out) : root;
  const prefix = opts.out ? "" : `resumes/${id}/`;
  await mkdir(outputRoot, { recursive: true });
  for (const file of ["resume.tex", "resume.pdf", "resume.md"]) resolveInWorkspace(outputRoot, prefix + file);
  await writeTextAtomic(outputRoot, `${prefix}resume.tex`, tex);
  await writeFile(resolveInWorkspace(outputRoot, `${prefix}resume.pdf`), pdf);
  await writeTextAtomic(outputRoot, `${prefix}resume.md`, renderMarkdown(resume, sources));
  console.log(JSON.stringify(check, null, 2));
  return check;
}

// Same limits as generation: master up to 2 pages, a base from its base.yaml, otherwise rules.yaml (default 1).
async function pageLimit(root: string, id: string, resume: Resume): Promise<number> {
  if (resume.kind === "master") return 2;
  const read = async (rel: string) => {
    try {
      return parseYaml(await readText(root, rel)) as unknown;
    } catch {
      return undefined;
    }
  };
  if (resume.kind === "base") {
    const base = BaseConfig.safeParse(await read(`resumes/${id}/base.yaml`));
    if (base.success && base.data.rules.max_pages) return base.data.rules.max_pages;
  }
  const rules = (await read("config/rules.yaml")) as { max_pages?: unknown } | undefined;
  return typeof rules?.max_pages === "number" ? rules.max_pages : 1;
}
