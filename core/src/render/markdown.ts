import type { Resume } from "@vita/shared";

import { contactView, linkedResume, type RenderSources } from "./links";

const mdText = (text: string) => text.replace(/[\\[\]]/g, "\\$&");
const mdLink = (label: string, href: string) =>
  `[${mdText(label)}](<${href.replace(/[<>\\]/g, (c) => encodeURIComponent(c))}>)`;

export function renderMarkdown(resume: Resume, sources: RenderSources = {}): string {
  resume = linkedResume(resume, sources);
  const blocks = [`# ${resume.header.name}`];
  if (resume.header.headline) blocks.push(resume.header.headline);
  if (resume.header.contact.length) {
    blocks.push(
      resume.header.contact
        .map(contactView)
        .map((contact) => (contact.href ? mdLink(contact.display, contact.href) : contact.display))
        .join(" · "),
    );
  }
  for (const section of resume.sections) {
    if (section.hidden) continue;
    blocks.push(`## ${section.title}`);
    if (section.text) blocks.push(section.text);
    for (const item of section.items) {
      if (item.hidden) continue;
      const subtitle = item.subtitle ? ` — ${item.subtitle}` : "";
      const period = item.period ? ` · ${item.period}` : "";
      const links = item.links?.map((link) => mdLink(link.label, link.url)).join(" · ");
      blocks.push(`### ${item.title}${links ? ` ${links}` : ""}${subtitle}${period}`);
      if (item.location) blocks.push(item.location);
      const bullets = item.bullets.filter((bullet) => !bullet.hidden).map((bullet) => `- ${bullet.text}`);
      if (bullets.length) blocks.push(bullets.join("\n"));
    }
  }
  return `${blocks.join("\n\n")}\n`;
}
