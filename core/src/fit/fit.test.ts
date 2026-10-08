import { type Resume, visibleBullets } from "@vita/shared";
import { beforeEach, expect, it, vi } from "vitest";
import * as render from "../render/index.js";
import { fitToPage } from "./index.js";
import { fixture, meta } from "./test-fixtures.js";

vi.mock("../render/index.js", async (original) => ({
  ...(await original<typeof render>()),
  renderTex: vi.fn((resume: Resume) => JSON.stringify(resume)),
  compileTex: vi.fn(async ({ tex }: { tex: string }) => ({ pdf: Buffer.from(tex), log: "" })),
  pdfText: vi.fn(),
}));

const tpl = { dir: "/unused", meta };
function pages(count: (resume: Resume) => number) {
  vi.mocked(render.pdfText).mockImplementation(async (pdf) => ({
    text: "",
    pages: count(JSON.parse(pdf.toString())),
  }));
}
beforeEach(() => {
  vi.clearAllMocks();
  pages(() => 2);
});

it("fits a two-page resume by layout alone and stops at the first successful step without mutations", async () => {
  const resume = fixture();
  const before = structuredClone(resume);
  pages((draft) => (Number(draft.layout.line_spread) <= 0.9 ? 1 : 2));
  const plan = await fitToPage(resume, tpl, { maxPages: 1 });
  expect(plan).toMatchObject({ pages: 1, fits: true, hide: [], layout: { line_spread: 0.9 } });
  expect(plan.steps).toEqual(["line_spread=0.95", "line_spread=0.9"]);
  expect(render.compileTex).toHaveBeenCalledTimes(3);
  expect(resume).toEqual(before);
});

it("tries four evenly spaced steps per knob in order, ending exactly at the minima", async () => {
  pages((draft) => (draft.layout.font_pt === 10 ? 1 : 2));
  const plan = await fitToPage(fixture(), tpl, { maxPages: 1 });
  expect(plan.hide).toEqual([]);
  expect(plan.steps.map((step) => step.split("=")[0])).toEqual([
    ...Array(4).fill("line_spread"),
    ...Array(4).fill("section_gap_pt"),
    ...Array(4).fill("margin_in"),
    ...Array(4).fill("font_pt"),
  ]);
  expect(plan.layout).toEqual({ line_spread: 0.8, section_gap_pt: 2, margin_in: 0.5, font_pt: 10, untouched: 2 });
  expect(render.compileTex).toHaveBeenCalledTimes(17);
});

it("uses resolved current values, skips missing or exhausted knobs, and measures an already fitting resume once", async () => {
  const resume = fixture();
  resume.layout = { line_spread: "0.9", section_gap_pt: -100, font_pt: 100 };
  const lineSpread = meta.knobs.line_spread;
  if (!lineSpread) throw new Error("Missing fixture knob");
  const custom = { ...tpl, meta: { ...meta, knobs: { line_spread: lineSpread } } };
  const plan = await fitToPage(resume, custom, { maxPages: 1 });
  expect(plan.steps.slice(0, 4)).toEqual([
    "line_spread=0.875",
    "line_spread=0.8500000000000001",
    "line_spread=0.8250000000000001",
    "line_spread=0.8",
  ]);
  pages(() => 1);
  vi.clearAllMocks();
  const already = await fitToPage(resume, tpl, { maxPages: 1 });
  expect(already).toMatchObject({ fits: true, hide: [], steps: [], layout: { section_gap_pt: 2, font_pt: 12 } });
  expect(render.compileTex).toHaveBeenCalledTimes(1);
});

it("hides last bullets from the longest visible items one at a time after exhausting layout", async () => {
  const resume = fixture([4, 2]);
  const before = structuredClone(resume);
  pages((draft) => (visibleBullets(draft).length <= 3 ? 1 : 2));
  const plan = await fitToPage(resume, tpl, { maxPages: 1 });
  expect(plan).toMatchObject({ pages: 1, fits: true, hide: ["bullet-0-3", "bullet-0-2", "bullet-0-1"] });
  expect(plan.steps.slice(16)).toEqual(["hide bullet-0-3", "hide bullet-0-2", "hide bullet-0-1"]);
  expect(render.compileTex).toHaveBeenCalledTimes(20);
  expect(resume).toEqual(before);
});

it("hides lowest relevance first, using the fallback to break tied scores", async () => {
  pages((draft) => (visibleBullets(draft).length <= 2 ? 1 : 2));
  const plan = await fitToPage(fixture(), tpl, {
    maxPages: 1,
    relevance: new Map([
      ["bullet-1-0", -1],
      ["bullet-0-2", 10],
    ]),
  });
  expect(plan.hide).toEqual(["bullet-1-0", "bullet-0-1", "bullet-0-0"]);
});

it("never hides locked bullets or already hidden content and reports an impossible fit", async () => {
  const resume = fixture([3, 1, 1]);
  for (const section of resume.sections) {
    for (const item of section.items) {
      if (item.id === "item-1") item.hidden = true;
      for (const bullet of item.bullets) {
        if (bullet.id === "bullet-0-2") bullet.locked = true;
        if (bullet.id === "bullet-0-1") bullet.hidden = true;
      }
    }
  }
  resume.sections.push({
    id: "hidden",
    title: "Hidden section",
    kind: "entries",
    hidden: true,
    items: [
      {
        id: "hidden-item",
        title: "Hidden item",
        bullets: [
          {
            ...visibleBullets(resume)[0],
            id: "hidden-bullet",
            text: "Hidden",
            claims: [],
            origin: "ai",
            locked: false,
          },
        ],
      },
    ],
  });
  const plan = await fitToPage(resume, tpl, {
    maxPages: 1,
    relevance: new Map([["bullet-0-2", -100]]),
  });
  expect(plan).toMatchObject({ pages: 2, fits: false, hide: ["bullet-0-0", "bullet-2-0"] });
  expect(render.compileTex).toHaveBeenCalledTimes(19);
});

it("rejects invalid page limits and pre-aborted requests without rendering", async () => {
  for (const maxPages of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    await expect(fitToPage(fixture(), tpl, { maxPages })).rejects.toThrow("Invalid page limit");
  await expect(fitToPage(fixture(), tpl, { maxPages: 1, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(render.compileTex).not.toHaveBeenCalled();
});

it("stops between renders when aborted during a compile", async () => {
  const controller = new AbortController();
  vi.mocked(render.compileTex).mockImplementationOnce(async ({ tex }) => {
    controller.abort();
    return { pdf: Buffer.from(tex), log: "" };
  });
  await expect(fitToPage(fixture(), tpl, { maxPages: 1, signal: controller.signal })).rejects.toThrow();
  expect(render.compileTex).toHaveBeenCalledTimes(1);
  expect(render.pdfText).not.toHaveBeenCalled();
});

it("propagates compile errors instead of proposing destructive guesses", async () => {
  vi.mocked(render.compileTex).mockRejectedValueOnce(new render.CompileError("Fixture compile failed"));
  await expect(fitToPage(fixture(), tpl, { maxPages: 1 })).rejects.toThrow("Fixture compile failed");
  expect(render.compileTex).toHaveBeenCalledTimes(1);
});
