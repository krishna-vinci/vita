import { type Resume, visibleBullets } from "@vita/shared";
import { compileTex, type LoadedTemplate, pdfText, renderTex, resolveLayout } from "../render/index.js";

export interface FitPlan {
  layout: Record<string, number>;
  hide: string[];
  pages: number;
  fits: boolean;
  steps: string[];
}

const KNOBS = ["line_spread", "section_gap_pt", "margin_in", "font_pt"] as const;

function nextBullet(resume: Resume, relevance?: Map<string, number>) {
  const items = resume.sections
    .filter((section) => !section.hidden)
    .flatMap((section) => section.items.filter((item) => !item.hidden))
    .map((item) => item.bullets.filter((bullet) => !bullet.hidden))
    .sort((a, b) => b.length - a.length);
  // Stable sorting preserves the longest-item / last-bullet fallback for tied scores.
  const candidates = items.flatMap((bullets) => bullets.toReversed().filter((bullet) => !bullet.locked));
  if (relevance) {
    const score = (id: string) => {
      const value = relevance.get(id) ?? 0;
      return Number.isFinite(value) ? value : 0;
    };
    candidates.sort((a, b) => score(a.id) - score(b.id));
  }
  return candidates[0];
}

export async function fitToPage(
  resume: Resume,
  tpl: LoadedTemplate,
  opts: { maxPages: number; relevance?: Map<string, number>; signal?: AbortSignal },
): Promise<FitPlan> {
  opts.signal?.throwIfAborted();
  if (!Number.isSafeInteger(opts.maxPages) || opts.maxPages < 1) throw new RangeError("Invalid page limit");
  const draft = structuredClone(resume);
  const layout = resolveLayout(tpl.meta, draft.layout);
  draft.layout = layout;
  const plan: FitPlan = { layout, hide: [], pages: 0, fits: false, steps: [] };
  const measure = async () => {
    opts.signal?.throwIfAborted();
    const compiled = await compileTex({ tex: renderTex(draft, tpl), assetsDir: tpl.dir });
    opts.signal?.throwIfAborted();
    plan.pages = (await pdfText(compiled.pdf)).pages;
    opts.signal?.throwIfAborted();
    plan.fits = plan.pages <= opts.maxPages;
    return plan.fits;
  };
  if (await measure()) return plan;
  for (const key of KNOBS) {
    const knob = tpl.meta.knobs[key];
    const start = layout[key];
    if (!knob || start === undefined || start <= knob.min) continue;
    for (let step = 1; step <= 4; step++) {
      layout[key] = step === 4 ? knob.min : start - ((start - knob.min) * step) / 4;
      plan.steps.push(`${key}=${layout[key]}`);
      if (await measure()) return plan;
    }
  }
  // Recompute item lengths after each hide so the fallback keeps longer items balanced.
  while (visibleBullets(draft).some((bullet) => !bullet.locked)) {
    const bullet = nextBullet(draft, opts.relevance);
    if (!bullet) break;
    bullet.hidden = true;
    plan.hide.push(bullet.id);
    plan.steps.push(`hide ${bullet.id}`);
    if (await measure()) return plan;
  }
  return plan;
}
