import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type Resume, Slug } from "@vita/shared";
import { compileTex } from "./compile";
import type { LoadedTemplate } from "./templates";
import { renderTex } from "./tex";
import { checkRender, pdfText } from "./textcheck";

const execute = promisify(execFile);

// Gallery thumbnails always show the first page at 150 dpi.
export async function renderTemplatePreview(
  resume: Resume,
  template: LoadedTemplate,
  maxPages?: number,
): Promise<Buffer> {
  const { pdf } = await compileTex({ tex: renderTex(resume, template), assetsDir: template.dir });
  const check = checkRender(resume, await pdfText(pdf), maxPages);
  if (!check.ok) throw new Error(`Template preview failed render check: ${JSON.stringify(check)}`);
  const dir = await mkdtemp(join(tmpdir(), "vita-preview-"));
  try {
    const input = join(dir, "resume.pdf");
    const output = join(dir, "preview");
    await writeFile(input, pdf);
    await execute("pdftoppm", ["-f", "1", "-singlefile", "-r", "150", "-png", input, output], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
    return await readFile(`${output}.png`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readBundledTemplatePreview(templatesDir: string, id: string): Promise<Buffer | null> {
  Slug.parse(id);
  try {
    const dir = join(await realpath(templatesDir), id);
    if (!(await lstat(dir)).isDirectory()) return null;
    const file = await open(join(dir, "preview.png"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 20 * 1024 * 1024) return null;
      return await file.readFile();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
    throw error;
  }
}
