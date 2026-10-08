import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { prescanTex } from "./prescan";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";

it("flags each forbidden construct, including path and pdfTeX hazards", () => {
  const sources = [
    "\\write18{command}",
    "\\immediate\\write{command}",
    "\\openout1=file",
    "\\directlua{command}",
    "\\ShellEscape{command}",
    "\\input{/etc/passwd}",
    "\\include{../outside}",
    "\\includegraphics[width=1in]{/tmp/image}",
    "\\input C:\\secret",
    "\\input{nested/../secret}",
    "\\input{\\filename}",
    "\\input|command",
    "\\usepackage{shellesc}",
    "\\usepackage[option]{other, shellesc}",
    "\\pdfgentounicode=1",
    "\\pdfoutput=1",
    "\\pdfminorversion=7",
    "\\input{glyphtounicode}",
    "^^5cinput{/etc/passwd}",
    "\\csname input\\endcsname",
    "\\catcode`X=0",
  ];
  for (const source of sources) {
    expect(prescanTex(`% comment\n${source}`), source).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: 2 })]),
    );
  }
});

it("accepts confined paths and guarded pdfTeX primitives, and ignores comments", () => {
  expect(
    prescanTex(
      "% \\write18{ignored}\n\\% \\input{local.tex}\n\\includegraphics[width=1in]{images/local.png}\n" +
        "\\ifdefined\\pdfgentounicode\\input{glyphtounicode}\\pdfgentounicode=1\\fi\n" +
        "\\ifdefined\\pdfoutput\\pdfoutput=1\\fi\n" +
        "\\ifdefined\\pdfminorversion\\pdfminorversion=7\\fi",
    ),
  ).toEqual([]);
  expect(prescanTex("\\ifdefined\\pdfoutput\\else\\pdfoutput=1\\fi")).toHaveLength(1);
  expect(prescanTex("\\ifdefined\\other\\pdfoutput=1\\fi")).toHaveLength(1);
});

it("accepts the rendered rover-base fixture", async () => {
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  expect(prescanTex(renderTex(resume, tpl))).toEqual([]);
});
