import { join } from "node:path";
import type { JobAnalysis, Letter, Profile, Resume } from "@vita/shared";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { checkRender, compileTex, createTexEnv, loadTemplate, pdfText, resolveLayout } from "../render/index.js";
import { resolveInWorkspace } from "../workspace/index.js";

/** Reuse the exact resume lint/checker/render checks with one paragraph per bullet. */
export function letterResume(letter: Letter, id: string, profile: Profile): Resume {
  return {
    id,
    kind: "job",
    parent: null,
    template: "rover-letter",
    layout: {},
    header: profile,
    sections: [
      {
        id: "letter-body",
        title: "",
        kind: "text",
        items: [{ id: "letter-paragraphs", title: "", bullets: letter.paragraphs }],
      },
    ],
  };
}

export function renderLetterMarkdown(letter: Letter): string {
  return `${[
    letter.greeting,
    ...letter.paragraphs.filter((paragraph) => !paragraph.hidden).map((paragraph) => paragraph.text),
    letter.closing,
    letter.signature,
  ].join("\n\n")}\n`;
}

export async function renderLetter(
  ws: WorkspaceHandle,
  id: string,
  letter: Letter,
  profile: Profile,
  analysis: JobAnalysis & { recipient?: string },
) {
  const template = await loadTemplate(
    [resolveInWorkspace(ws.root, "templates"), join(ws.bundledDir, "templates")],
    "rover-letter",
  );
  const tex = createTexEnv(template.dir).render("main.tex.njk", {
    header: profile,
    letter: { ...letter, paragraphs: letter.paragraphs.filter((paragraph) => !paragraph.hidden) },
    company: analysis.company ?? "",
    recipient: analysis.recipient ?? "",
    layout: resolveLayout(template.meta, {}),
  });
  const compiled = await compileTex({ tex, assetsDir: template.dir });
  const extracted = await pdfText(compiled.pdf);
  // Also check the engine-owned framing; the paragraph IDs remain the IDs in review notes.
  const document = letterResume(letter, id, profile);
  const item = document.sections[0]?.items[0];
  if (!item) throw new Error("Missing letter paragraph adapter");
  const bullets = item.bullets;
  const framing = (id: string, text: string) => ({ id, text, claims: [], origin: "user" as const, locked: true });
  item.bullets = [
    framing("$greeting", letter.greeting),
    ...bullets,
    framing("$closing", letter.closing),
    framing("$signature", letter.signature),
  ];
  return {
    tex,
    pdf: compiled.pdf,
    markdown: renderLetterMarkdown(letter),
    render: checkRender(document, extracted, 1),
  };
}
