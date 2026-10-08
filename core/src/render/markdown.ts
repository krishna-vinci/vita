import type { Resume } from "@vita/shared";

export function renderMarkdown(resume: Resume): string {
  const blocks = [`# ${resume.header.name}`];
  if (resume.header.headline) blocks.push(resume.header.headline);
  if (resume.header.contact.length) {
    blocks.push(resume.header.contact.map((contact) => `${contact.label}: ${contact.value}`).join(" · "));
  }
  for (const section of resume.sections) {
    if (section.hidden) continue;
    blocks.push(`## ${section.title}`);
    if (section.text) blocks.push(section.text);
    for (const item of section.items) {
      if (item.hidden) continue;
      const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
      const period = item.period ? ` · ${item.period}` : "";
      blocks.push(`### ${item.title}${subtitle}${period}`);
      if (item.location) blocks.push(item.location);
      const bullets = item.bullets.filter((bullet) => !bullet.hidden).map((bullet) => `- ${bullet.text}`);
      if (bullets.length) blocks.push(bullets.join("\n"));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
