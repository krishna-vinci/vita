import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type RenderCheck, type Resume, visibleBullets } from "@vita/shared";

const execute = promisify(execFile);

export async function pdfText(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const dir = await mkdtemp(join(tmpdir(), "vita-pdftext-"));
  try {
    const file = join(dir, "resume.pdf");
    await writeFile(file, pdf);
    const [extracted, info] = await Promise.all([
      execute("pdftotext", ["-layout", file, "-"], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }),
      execute("pdfinfo", [file], { timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }),
    ]);
    const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("pdfinfo did not return a valid page count");
    return { text: extracted.stdout, pages };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/[-\u00ad]\s*\r?\n\s*/g, "")
    .replace(/\u00ad/g, "")
    .replace(/``|''|[“”„]/g, '"')
    .replace(/[‘’`]/g, "'")
    .replace(/---|--|[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function checkRender(
  resume: Resume,
  extracted: { text: string; pages: number },
  maxPages?: number,
): RenderCheck {
  const text = normalizeForMatch(extracted.text);
  const missingBullets: string[] = [];
  const outOfOrder: string[] = [];
  let next = 0;
  for (const bullet of visibleBullets(resume)) {
    const normalized = normalizeForMatch(bullet.text);
    const position = text.indexOf(normalized, next);
    if (position >= 0) {
      next = position + normalized.length;
    } else if (text.indexOf(normalized) >= 0) {
      outOfOrder.push(bullet.id);
    } else {
      missingBullets.push(bullet.id);
    }
  }
  return {
    pages: extracted.pages,
    ...(maxPages === undefined ? {} : { maxPages }),
    missingBullets,
    outOfOrder,
    ok:
      missingBullets.length === 0 && outOfOrder.length === 0 && (maxPages === undefined || extracted.pages <= maxPages),
  };
}
