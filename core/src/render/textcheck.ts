import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { orderedSections, type RenderCheck, type Resume, visibleBullets } from "@vita/shared";

const execute = promisify(execFile);

export async function pdfText(pdf: Buffer, marginIn = 0.75): Promise<{ text: string; pages: number; fill?: number }> {
  const dir = await mkdtemp(join(tmpdir(), "vita-pdftext-"));
  try {
    const file = join(dir, "resume.pdf");
    await writeFile(file, pdf);
    const [extracted, boxes, info] = await Promise.all([
      execute("pdftotext", ["-layout", file, "-"], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }),
      execute("pdftotext", ["-bbox-layout", file, "-"], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }),
      execute("pdfinfo", [file], { timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }),
    ]);
    const pages = Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("pdfinfo did not return a valid page count");
    return {
      text: extracted.stdout,
      pages,
      fill: bboxFill(boxes.stdout, { top: marginIn * 72, bottom: marginIn * 72 }),
    };
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
    .replace(/---|--|[‐‑–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function checkRender(
  resume: Resume,
  extracted: { text: string; pages: number; fill?: number },
  maxPages?: number,
): RenderCheck {
  // Compare without whitespace: PDF extraction can split words where microtype or kerning
  // widens a gap (e.g. "Trained" extracted as "T rained").
  // List-marker glyphs can land inside the first word ("A•utomated"); drop them too.
  // Hyphens go as well: a line break at a real hyphen ("self-⏎hosted") is extracted without it.
  const compact = (value: string) => normalizeForMatch(value).replace(/[\s•◦▪‣∙·-]+/g, "");
  const text = compact(extracted.text);
  const missingBullets: string[] = [];
  const outOfOrder: string[] = [];
  let next = 0;
  for (const bullet of visibleBullets({ ...resume, sections: orderedSections(resume) })) {
    const normalized = compact(bullet.text);
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
    ...(extracted.fill === undefined
      ? {}
      : { fill: Math.min(1, (extracted.pages - 1 + extracted.fill) / (maxPages ?? extracted.pages)) }),
    ...(maxPages === undefined ? {} : { maxPages }),
    missingBullets,
    outOfOrder,
    ok:
      missingBullets.length === 0 && outOfOrder.length === 0 && (maxPages === undefined || extracted.pages <= maxPages),
  };
}

/** Last page's lowest text edge relative to the usable page height (PDF points). */
export function bboxFill(xml: string, margins = { top: 54, bottom: 54 }): number {
  const pages = [...xml.matchAll(/<page\b[^>]*height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)];
  const last = pages.at(-1);
  if (!last) throw new Error("pdftotext returned no page bounding boxes");
  const height = Number(last[1]);
  const usable = height - margins.top - margins.bottom;
  if (!(usable > 0)) throw new Error("Page margins leave no usable height");
  const words = [...(last[2] ?? "").matchAll(/<word\b[^>]*yMax="([\d.]+)"/g)];
  // Ignore text in margins, e.g. a running footer or page number.
  const bottoms = words
    .map((word) => Number(word[1]))
    .filter((y) => y >= margins.top && y <= height - margins.bottom + 1);
  const lowest = bottoms.reduce((lowest, value) => Math.max(lowest, value), margins.top);
  return Math.max(0, Math.min(1, (lowest - margins.top) / usable));
}

export async function measureFill(pdf: Buffer, marginIn = 0.75): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "vita-fill-"));
  try {
    const file = join(dir, "resume.pdf");
    await writeFile(file, pdf);
    const { stdout } = await execute("pdftotext", ["-bbox-layout", file, "-"], {
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return bboxFill(stdout, { top: marginIn * 72, bottom: marginIn * 72 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
