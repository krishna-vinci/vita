import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@vita/shared";
import { expect, it } from "vitest";
import { writeTextAtomic } from "../workspace/index.js";
import { compileTex, tectonicAvailable } from "./compile.js";
import { latexEscape } from "./escape.js";
import { applyTexPatch, checkPatchedRender, createTexPatch, storedTexPatch } from "./patch.js";
import { loadTemplate } from "./templates.js";
import { renderTex } from "./tex.js";
import { pdfText } from "./textcheck.js";

it("round-trips patches, relocates hunks after unrelated edits and records failed hunks without applying partial changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vita-patch-"));
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Alex" },
    sections: [],
  });
  const generated = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n";
  const modified = generated.replace("eight", "eight\\vspace{1pt}");
  const patch = createTexPatch(generated, modified);
  try {
    await writeTextAtomic(root, "resumes/master/tex.patch", patch);
    expect((await storedTexPatch(root, resume, generated)).patched).toBe(modified);
    const changed = generated.replace("one", "elsewhere\none");
    expect((await storedTexPatch(root, resume, changed)).patched).toContain("eight\\vspace{1pt}");
    const conflict = await storedTexPatch(root, resume, generated.replace("eight", "replaced"));
    expect(conflict.patched).toBe(conflict.generated);
    expect(conflict.conflict?.failedHunks).toHaveLength(1);
    expect(JSON.parse(await readFile(join(root, "resumes/master/tex.conflict.json"), "utf8"))).toEqual(
      conflict.conflict,
    );
    await storedTexPatch(root, resume, generated);
    await expect(readFile(join(root, "resumes/master/tex.conflict.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => applyTexPatch(generated, createTexPatch(generated, `${modified}\\input{/etc/passwd}`))).toThrow(
      "Unsafe LaTeX patch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("checks the patched PDF: layout changes and footers pass, removed bullets and new unchecked list items fail", async (context) => {
  if (!(await tectonicAvailable())) {
    console.warn("Skipping patch PDF test: Tectonic is absent.");
    context.skip();
  }
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  const template = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const generated = renderTex(resume, template);
  for (const [replacement, ok] of [
    ["\\vspace{1pt}\nLayout footer\\par\n\\end{document}", true],
    ["\\begin{itemize}\\item Invented a wholly unsupported outcome.\\end{itemize}\n\\end{document}", false],
  ] as const) {
    const patched = generated.replace("\\end{document}", replacement);
    const { pdf } = await compileTex({ tex: patched, assetsDir: template.dir });
    expect(checkPatchedRender(resume, await pdfText(pdf), 2, generated, patched).ok).toBe(ok);
  }
  const text = resume.sections.flatMap((section) => section.items.flatMap((item) => item.bullets))[0]?.text;
  if (!text) throw new Error("Fixture needs a bullet");
  const patched = generated.replace(latexEscape(text), "A replacement that omits the checked claim.");
  const { pdf } = await compileTex({ tex: patched, assetsDir: template.dir });
  expect(checkPatchedRender(resume, await pdfText(pdf), 2, generated, patched).ok).toBe(false);
}, 60_000);

it("resolves base.yaml style defaults before patches, with per-resume values taking precedence", async () => {
  const { renderStoredTex } = await import("./patch.js");
  const root = await mkdtemp(join(tmpdir(), "vita-base-style-"));
  try {
    const resume = Resume.parse(
      JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
    );
    resume.kind = "job";
    resume.id = "example-job";
    resume.parent = "example-base";
    await writeTextAtomic(
      root,
      "resumes/example-base/base.yaml",
      "name: Example\nlayout:\n  font: fira-sans\n  icons: true\n  accent: '#123456'\n",
    );
    const template = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
    const inherited = await renderStoredTex(root, resume, template);
    expect(inherited.generated).toContain("\\usepackage[sfdefault,semibold,lf]{FiraSans}");
    expect(inherited.generated).toContain("\\definecolor{accent}{HTML}{123456}");
    resume.layout = { accent: "#AABBCC" };
    expect((await renderStoredTex(root, resume, template)).generated).toContain("\\definecolor{accent}{HTML}{AABBCC}");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
