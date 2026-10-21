import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Resume, Section } from "@vita/shared";
import { beforeAll, expect, it } from "vitest";
import { parse } from "yaml";
import { compileTex, tectonicAvailable } from "./compile";
import { prescanTex } from "./prescan";
import { readBundledTemplatePreview } from "./preview";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";
import { checkRender, pdfText } from "./textcheck";

const templatesDir = fileURLToPath(new URL("../../../templates/", import.meta.url));
const ids = (
  await Promise.all(
    (
      await readdir(templatesDir, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map(async (entry) =>
        (await loadTemplate([templatesDir], entry.name)).meta.kind === "resume" ? entry.name : null,
      ),
  )
)
  .filter((id): id is string => id !== null)
  .sort();
const fixtures = ["developer", "nurse", "teacher", "accountant"];
let available = false;
beforeAll(async () => {
  available = await tectonicAvailable();
  if (!available) console.warn("Skipping bundled template PDF tests: tectonic is not on PATH.");
});

it("bundles every supplied Rover design with attribution, safe defaults and a PNG preview", async () => {
  expect(ids).toEqual([
    "rover-academic",
    "rover-base",
    "rover-fancy",
    "rover-milky",
    "rover-obsolete",
    "rover-office",
    "rover-star",
    "rover-week-monday",
    "rover-week-sunday",
    "rover-week-thursday",
    "rover-week-tuesday",
    "rover-week-wednesday",
  ]);
  const fixture = Resume.parse(
    JSON.parse(
      await readFile(new URL("../../../fixtures/developer/resumes/master/resume.json", import.meta.url), "utf8"),
    ),
  );
  for (const id of ids) {
    const template = await loadTemplate([templatesDir], id);
    expect(template.meta.description).toBeTruthy();
    expect(template.meta.source).toMatchObject({ licence: "CC-BY-4.0", author: "Rover resume templates (subidit)" });
    const tex = renderTex(fixture, template);
    expect(prescanTex(tex), id).toEqual([]);
    expect(tex).toContain("microtype");
    expect(tex).toContain("\\setlength{\\parindent}{0pt}");
    expect(tex).toContain("leftmargin=");
    expect(tex).not.toMatch(/pdfgentounicode|includegraphics|bibliography|addbibresource/);
    const png = await readBundledTemplatePreview(templatesDir, id);
    expect(png?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});

for (const id of ids) {
  for (const fixture of fixtures) {
    it(`${id} renders ${fixture} in order within its page budget`, async (context) => {
      if (!available) context.skip();
      const root = new URL(`../../../fixtures/${fixture}/`, import.meta.url);
      const resume = Resume.parse(JSON.parse(await readFile(new URL("resumes/master/resume.json", root), "utf8")));
      resume.header.contact = [
        { label: "Website", value: "https://www.example.test/" },
        { label: "Email", value: "alex@example.test" },
      ];
      const entry = resume.sections.find((section) => section.kind === "entries")?.items[0];
      if (!entry) throw new Error("Fixture needs an entry");
      entry.links = [
        { label: "Website", url: "https://example.test/site?x=1%25#section" },
        { label: "GitHub", url: "https://github.com/example/records" },
      ];
      const rules = parse(await readFile(new URL("config/rules.yaml", root), "utf8")) as { max_pages: number };
      const template = await loadTemplate([templatesDir], id);
      const tex = renderTex({ ...resume, template: id }, template);
      expect(tex).toContain("\\href{https://example.test/site?x=1\\%25\\#section}{Website}");
      const { pdf } = await compileTex({
        tex,
        assetsDir: template.dir,
      });
      const extracted = await pdfText(pdf);
      expect(checkRender(resume, extracted, rules.max_pages), extracted.text).toMatchObject({
        missingBullets: [],
        outOfOrder: [],
        ok: true,
      });
    }, 60_000);
  }
}

for (const kind of ["list", "entries"] as const) {
  it(`academic renders ${kind} publications with empty optional fields and all section kinds`, async (context) => {
    if (!available) context.skip();
    const resume = Resume.parse(
      JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
    );
    resume.header = { name: "Alex Example", headline: "", contact: [] };
    resume.sections.push(
      Section.parse({
        id: "publications",
        title: "Publications",
        kind,
        items: [
          {
            id: "paper",
            title: "Notes & Records",
            bullets: [{ id: "paper-text", text: "Published clear notes about a review process.", claims: [] }],
          },
          { id: "paper-empty", title: "Second publication", bullets: [] },
        ],
      }),
    );
    const template = await loadTemplate([templatesDir], "rover-academic");
    const tex = renderTex(resume, template);
    expect(tex).toContain("\\begin{enumerate}");
    const { pdf } = await compileTex({ tex, assetsDir: template.dir });
    expect(checkRender(resume, await pdfText(pdf), 1).ok).toBe(true);
  }, 60_000);
}

for (const id of ids) {
  it(`${id} renders all section kinds and mixed lists with optional fields empty`, async (context) => {
    if (!available) context.skip();
    const resume = Resume.parse(
      JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
    );
    resume.header = { name: "Alex Example", headline: "", contact: [] };
    resume.sections.push(
      Section.parse({
        id: "mixed-list",
        title: "A & B",
        kind: "list",
        items: [
          {
            id: "mixed-first",
            title: "Tools",
            bullets: [{ id: "mixed-first-bullet", text: "Prepared review notes." }],
          },
          { id: "mixed-plain", title: "Planning" },
          { id: "mixed-last", title: "", bullets: [{ id: "mixed-last-bullet", text: "Recorded decisions clearly." }] },
        ],
      }),
    );
    for (const section of resume.sections)
      for (const item of section.items) {
        item.subtitle = "";
        item.location = "";
        item.period = "";
      }
    const template = await loadTemplate([templatesDir], id);
    const { pdf } = await compileTex({ tex: renderTex(resume, template), assetsDir: template.dir });
    expect(checkRender(resume, await pdfText(pdf), 1).ok).toBe(true);
  }, 60_000);
}

for (const id of ids) {
  it.concurrent(`${id} compiles defaults and every exposed option at its alternative values offline`, async (context) => {
    if (!available) context.skip();
    const template = await loadTemplate([templatesDir], id);
    const resume = Resume.parse(
      JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
    );
    resume.header.location = "Example City";
    resume.header.contact = [
      { label: "Email", value: "alex@example.test" },
      { label: "Website", value: "https://example.test" },
    ];
    const entry = resume.sections.find((section) => section.kind === "entries")?.items[0];
    if (entry) {
      entry.period = "2023-01 – 2026-10";
      entry.links = [{ label: "Website", url: "https://example.test" }];
    }
    const layouts: Resume["layout"][] = [{}];
    for (const [key, knob] of Object.entries(template.meta.knobs)) {
      const values =
        knob.type === "enum"
          ? knob.options.filter((value) => value !== knob.default)
          : knob.type === "bool"
            ? [!knob.default]
            : knob.type === "color"
              ? ["#7521A8"]
              : [knob.max];
      layouts.push(...values.map((value) => ({ [key]: value })));
    }
    layouts.push({
      font: "fira-sans",
      accent: "#141E61",
      icons: true,
      footer: "name+page",
      link_style: "label+icon",
      header_align: "center",
    });
    for (const layout of layouts) {
      const tex = renderTex({ ...resume, template: id, layout }, template);
      if (layout.accent) expect(tex).toContain(`\\definecolor{accent}{HTML}{${String(layout.accent).slice(1)}}`);
      const { pdf } = await compileTex({ tex, assetsDir: template.dir }).catch((error) => {
        throw new Error(`${id} ${JSON.stringify(layout)}: ${error.message}\n${error.log?.slice(-6000)}`);
      });
      const extracted = await pdfText(pdf);
      expect(checkRender(resume, extracted).ok, `${id} ${JSON.stringify(layout)}\n${extracted.text}`).toBe(true);
      expect(extracted.text).toContain("Example City");
      if (layout.footer === "name+page") expect(extracted.text).toMatch(/Page 1 of 1/);
    }
  }, 180_000);
}
