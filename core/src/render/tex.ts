import type { Resume } from "@vita/shared";
import { contactView, linkedResume, type RenderSources } from "./links";
import { createTexEnv } from "./nunjucks";
import { type LoadedTemplate, resolveLayout } from "./templates";

export function renderTex(resume: Resume, tpl: LoadedTemplate, sources: RenderSources = {}): string {
  resume = linkedResume(resume, sources);
  const sections = resume.sections
    .filter((section) => !section.hidden)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => !item.hidden)
        .map((item) => ({ ...item, bullets: item.bullets.filter((bullet) => !bullet.hidden) })),
    }))
    .map((section) => ({
      ...section,
      // Convenience views so templates need no array logic: list items with and without detail,
      // and every visible bullet's text for paragraph-style sections (summary, text).
      plainItems: section.items.filter((item) => item.bullets.length === 0),
      detailItems: section.items.filter((item) => item.bullets.length > 0),
      paragraphs: [
        ...(section.text ? [section.text] : []),
        ...section.items.flatMap((item) => item.bullets.map((bullet) => bullet.text)),
      ],
    }));
  return createTexEnv(tpl.dir).render("main.tex.njk", {
    header: { ...resume.header, contact: resume.header.contact.map(contactView) },
    sections,
    layout: resolveLayout(tpl.meta, resume.layout),
  });
}
