import type { Resume } from "@vita/shared";
import { createTexEnv } from "./nunjucks";
import { type LoadedTemplate, resolveLayout } from "./templates";

export function renderTex(resume: Resume, tpl: LoadedTemplate): string {
  const sections = resume.sections
    .filter((section) => !section.hidden)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => !item.hidden)
        .map((item) => ({ ...item, bullets: item.bullets.filter((bullet) => !bullet.hidden) })),
    }));
  return createTexEnv(tpl.dir).render("main.tex.njk", {
    header: resume.header,
    sections,
    layout: resolveLayout(tpl.meta, resume.layout),
  });
}
