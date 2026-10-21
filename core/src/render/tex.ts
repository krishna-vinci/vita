import { orderedSections, type Resume } from "@vita/shared";
import { contactView, linkedResume, type RenderSources } from "./links";
import { createTexEnv } from "./nunjucks";
import { type LoadedTemplate, resolveLayout } from "./templates";

export function renderTex(resume: Resume, tpl: LoadedTemplate, sources: RenderSources = {}): string {
  resume = linkedResume(resume, sources);
  const layout = resolveLayout(tpl.meta, resume.layout);
  const sections = orderedSections(resume)
    .filter((section) => !section.hidden)
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => !item.hidden)
        .map((item) => ({
          ...item,
          period: formatPeriod(item.period, layout.date_format),
          bullets: item.bullets.filter((bullet) => !bullet.hidden),
        })),
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
    header: {
      ...resume.header,
      contact: resume.header.contact.map((contact) => ({
        ...contactView(contact),
        icon: contactIcon(contactView(contact).href),
      })),
    },
    sections,
    layout: Object.fromEntries(
      Object.entries(layout).map(([key, value]) => [
        key,
        tpl.meta.knobs[key]?.type === "color" ? String(value).slice(1) : value,
      ]),
    ),
  });
}

function contactIcon(href?: string | null): string {
  if (href?.startsWith("mailto:")) return "envelope";
  if (href?.startsWith("tel:")) return "phone";
  if (href?.includes("github.com/")) return "github";
  if (href?.includes("linkedin.com/")) return "linkedin";
  return "globe";
}

export function formatPeriod(period: string | undefined, format: unknown): string | undefined {
  if (!period || !format || format === "original") return period;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (format === "year")
    return period
      .replace(/\b(\d{4})-\d{2}(?:-\d{2})?\b/g, "$1")
      .replace(
        /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})/gi,
        "$1",
      );
  return period.replace(
    /\b(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?\b/g,
    (_, year, month) => `${months[Number(month) - 1]} ${year}`,
  );
}
