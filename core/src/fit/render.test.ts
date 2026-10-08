import { fileURLToPath } from "node:url";
import { TemplateMeta, visibleBullets } from "@vita/shared";
import { beforeAll, expect, it } from "vitest";
import { compileTex, pdfText, renderTex, tectonicAvailable } from "../render/index.js";
import { fitToPage } from "./index.js";
import { fixture } from "./test-fixtures.js";

const tpl = {
  dir: fileURLToPath(new URL("./fixtures", import.meta.url)),
  meta: TemplateMeta.parse({
    id: "fit-fixture",
    name: "Fit fixture",
    knobs: { line_spread: { min: 0.8, max: 1, default: 1 } },
    supports: ["entries"],
  }),
};
let available = false;
beforeAll(async () => {
  available = await tectonicAvailable();
  if (!available) console.warn("Skipping fit render integration tests: tectonic is not on PATH.");
});

it("fits a real two-page PDF using layout only", async (context) => {
  if (!available) context.skip();
  const resume = fixture([4]);
  const compiled = await compileTex({ tex: renderTex(resume, tpl), assetsDir: tpl.dir });
  expect((await pdfText(compiled.pdf)).pages).toBe(2);
  const plan = await fitToPage(resume, tpl, { maxPages: 1 });
  expect(plan).toMatchObject({ fits: true, pages: 1, hide: [], layout: { line_spread: 0.8 } });
}, 60_000);

it("fits a longer PDF by hiding unlocked bullets while preserving a locked final bullet", async (context) => {
  if (!available) context.skip();
  const resume = fixture([6]);
  const last = visibleBullets(resume).at(-1);
  if (!last) throw new Error("Missing fixture bullet");
  last.locked = true;
  const plan = await fitToPage(resume, tpl, { maxPages: 1 });
  expect(plan).toMatchObject({ fits: true, pages: 1, hide: ["bullet-0-4", "bullet-0-3"] });
  expect(visibleBullets(resume)).toHaveLength(6);
}, 60_000);

it("returns fits false when a real PDF cannot fit without hiding locked bullets", async (context) => {
  if (!available) context.skip();
  const resume = fixture([6]);
  for (const bullet of visibleBullets(resume)) bullet.locked = true;
  expect(await fitToPage(resume, tpl, { maxPages: 1 })).toMatchObject({ fits: false, pages: 2, hide: [] });
}, 60_000);
