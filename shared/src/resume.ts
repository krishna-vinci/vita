import { z } from "zod";
import { ClaimId, Slug } from "./ids";

export const Contact = z.object({ label: z.string(), value: z.string(), url: z.string().optional() });
export type Contact = z.infer<typeof Contact>;

export const OverrideRecord = z.object({
  reason: z.enum(["user-attested", "this-resume-only"]),
  at: z.string(),
  note: z.string().optional(),
});
export type OverrideRecord = z.infer<typeof OverrideRecord>;

export const Bullet = z.object({
  id: z.string().min(1),
  text: z.string(),
  claims: z.array(ClaimId).default([]),
  origin: z.enum(["ai", "user"]).default("ai"),
  locked: z.boolean().default(false),
  hidden: z.boolean().optional(),
  variantOf: z.string().optional(),
  override: OverrideRecord.optional(),
});
export type Bullet = z.infer<typeof Bullet>;

export const ItemLink = z.object({ label: z.string(), url: z.string() });
export type ItemLink = z.infer<typeof ItemLink>;

export const Item = z.object({
  id: z.string().min(1),
  title: z.string(),
  subtitle: z.string().optional(),
  period: z.string().optional(),
  location: z.string().optional(),
  bullets: z.array(Bullet).default([]),
  hidden: z.boolean().optional(),
  source: z.string().optional(),
  links: z.array(ItemLink).max(4).optional(),
});
export type Item = z.infer<typeof Item>;

export const SectionKind = z.enum(["summary", "entries", "list", "text"]);
export type SectionKind = z.infer<typeof SectionKind>;

export const Section = z.object({
  id: z.string().min(1),
  title: z.string(),
  kind: SectionKind,
  items: z.array(Item).default([]),
  text: z.string().optional(),
  hidden: z.boolean().optional(),
});
export type Section = z.infer<typeof Section>;

export const Resume = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["master", "base", "job"]),
    parent: z.string().nullable(),
    template: Slug,
    layout: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
    header: z.object({
      name: z.string(),
      headline: z.string().optional(),
      location: z.string().optional(),
      contact: z.array(Contact).default([]),
    }),
    sections: z.array(Section),
  })
  .superRefine((resume, ctx) => {
    const ids = new Set<string>();
    const checkId = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate id: ${id}`, path });
      }
      ids.add(id);
    };

    resume.sections.forEach((section, sectionIndex) => {
      const sectionPath = ["sections", sectionIndex];
      checkId(section.id, [...sectionPath, "id"]);
      section.items.forEach((item, itemIndex) => {
        const itemPath = [...sectionPath, "items", itemIndex];
        checkId(item.id, [...itemPath, "id"]);
        item.bullets.forEach((bullet, bulletIndex) => {
          checkId(bullet.id, [...itemPath, "bullets", bulletIndex, "id"]);
        });
      });
    });
  });
export type Resume = z.infer<typeof Resume>;

export function visibleBullets(resume: Resume): Bullet[] {
  const bullets: Bullet[] = [];
  for (const section of resume.sections) {
    if (section.hidden) continue;
    for (const item of section.items) {
      if (item.hidden) continue;
      for (const bullet of item.bullets) {
        if (!bullet.hidden) bullets.push(bullet);
      }
    }
  }
  return bullets;
}
