import { fileURLToPath } from "node:url";
import { Letter, Profile } from "@vita/shared";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as render from "../render/index.js";
import { renderLetter, renderLetterMarkdown } from "./render.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const ws = { root: bundledDir, bundledDir };
const profile = Profile.parse({ name: "Alex Example", contact: [] });
const letter = Letter.parse({
  greeting: "Dear Hiring Team,",
  closing: "Sincerely,",
  signature: "Alex Example",
  paragraphs: [
    { id: "p1", text: "I am interested in the service coordinator role.", claims: ["work"] },
    { id: "p2", text: "I organised records and documented the review process.", claims: ["work"] },
    { id: "p3", text: "I would welcome a conversation about the role.", claims: ["work"] },
  ],
});
let available: boolean;
beforeAll(async () => {
  available = await render.tectonicAvailable();
  if (!available) console.warn("Skipping real cover-letter PDF check: Tectonic is not on PATH.");
});
afterEach(() => vi.restoreAllMocks());

it("escapes letter/profile/recipient data, omits hidden paragraphs and accepts empty optional fields", async () => {
  const value = structuredClone(letter);
  at(value.paragraphs, 0).text = "Built A & B_ with 50% coverage.";
  at(value.paragraphs, 1).hidden = true;
  value.signature = "Alex & Example";
  const header = Profile.parse({ name: value.signature, contact: [] });
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("stub-pdf"), log: "" });
  vi.spyOn(render, "pdfText").mockResolvedValue({
    text: [value.greeting, value.paragraphs[0]?.text, value.paragraphs[2]?.text, value.closing, value.signature].join(
      "\n",
    ),
    pages: 1,
  });
  const result = await renderLetter(ws, "example", value, header, {
    title: "Coordinator",
    company: "A & B_",
    recipient: "Sam & Co",
    requirements: [],
    baseScores: [],
  });
  expect(result.tex).toContain("Built A \\& B\\_ with 50\\% coverage.");
  expect(result.tex).toContain("Sam \\& Co");
  expect(result.tex).not.toContain(value.paragraphs[1]?.text);
  expect(result.tex).toContain("\\usepackage{microtype}");
  expect(result.tex).toContain("\\setlength{\\parindent}{0pt}");
  expect(result.render.ok).toBe(true);
  expect(renderLetterMarkdown(value)).not.toContain(value.paragraphs[1]?.text);
});

it("blocks missing/out-of-order paragraph text and page overflow", async () => {
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("stub-pdf"), log: "" });
  vi.spyOn(render, "pdfText").mockResolvedValue({
    text: [
      letter.greeting,
      letter.paragraphs[2]?.text,
      letter.paragraphs[0]?.text,
      letter.closing,
      letter.signature,
    ].join("\n"),
    pages: 2,
  });
  const result = await renderLetter(ws, "example", letter, profile, {
    title: "Coordinator",
    requirements: [],
    baseScores: [],
  });
  expect(result.render).toMatchObject({ ok: false, pages: 2, maxPages: 1, missingBullets: ["p2"], outOfOrder: ["p3"] });
});

it("supports the standard bundled-template cache warm-up context", async () => {
  const template = await render.loadTemplate([`${bundledDir}/templates`], "rover-letter");
  const tex = render.renderTex(
    {
      id: "sample",
      kind: "master",
      parent: null,
      template: "rover-letter",
      layout: {},
      header: profile,
      sections: [
        {
          id: "summary",
          kind: "text",
          title: "Summary",
          items: [{ id: "work", title: "", bullets: letter.paragraphs }],
        },
      ],
    },
    template,
  );
  expect(tex).toContain(letter.paragraphs[1]?.text);
});

it("compiles Rover Letter and passes the real PDF reading-order check", async (context) => {
  if (!available) return context.skip();
  const result = await renderLetter(ws, "example", letter, profile, {
    title: "Coordinator",
    company: "Example",
    requirements: [],
    baseScores: [],
  });
  expect(result.pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(result.render).toMatchObject({ ok: true, pages: 1, missingBullets: [], outOfOrder: [] });
});

function at<T>(values: T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing test value: ${index}`);
  return value;
}
