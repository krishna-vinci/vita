import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";

it("renders escaped visible content of every section kind and applies layout knobs", async () => {
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  resume.layout = { font_pt: 11, margin_in: 0.5, section_gap_pt: 2, line_spread: 0.95 };
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const tex = renderTex(resume, tpl);
  expect(tex).toContain(
    "Recorded \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
  );
  expect(tex).toContain("Prepared ``clear'' notes --- including `office' updates -- for everyone.");
  expect(tex).toContain("Coordination, Writing \\& editing");
  expect(tex).toContain("Available for local assignments.");
  expect(tex).not.toContain("HIDDEN");
  expect(tex).not.toContain("pdfgentounicode");
  expect(tex).toContain("margin=0.5in");
  expect(tex).toContain("\\fontsize{11}{13.2}\\selectfont");
  expect(tex).toContain("\\linespread{0.95}");
});

it("omits the contact minipage and headline break when header fields are empty", async () => {
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Alex", headline: "", contact: [] },
    sections: [],
  });
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const tex = renderTex(resume, tpl);
  expect(tex.match(/\\begin\{minipage\}/g)).toHaveLength(1);
  expect(tex).not.toContain("\\hfill");
  expect(tex).not.toContain("\\\\ \\medskip");
  resume.header = { name: "", headline: "Headline", contact: [] };
  expect(renderTex(resume, tpl)).not.toContain("\\\\ \\medskip");
});

it("renders bullets placed in summary and list sections", async () => {
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Alex" },
    sections: [
      {
        id: "s",
        title: "Summary",
        kind: "summary",
        items: [{ id: "si", title: "", bullets: [{ id: "s1", text: "Calm planner." }] }],
      },
      {
        id: "k",
        title: "Skills",
        kind: "list",
        items: [
          {
            id: "k1",
            title: "Tools",
            bullets: [
              { id: "k1a", text: "Spreadsheets" },
              { id: "k1b", text: "Rostering" },
            ],
          },
          { id: "k2", title: "First aid" },
        ],
      },
    ],
  });
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const tex = renderTex(resume, tpl);
  expect(tex).toContain("Calm planner.\\par");
  expect(tex).toContain("\\textbf{Tools}: Spreadsheets; Rostering\\par");
  expect(tex).toContain("First aid\\par");
});
