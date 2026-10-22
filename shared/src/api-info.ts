import { z } from "zod";
import { Relationship } from "./evidence";
import { ClaimId, Slug } from "./ids";
import { Profile } from "./profile";
import { HttpUrl } from "./resume";

const line = z
  .string()
  .trim()
  .max(20_000)
  .refine((text) => !/[\r\n\0]/.test(text) && !text.includes("<!--"), "Expected plain text on one line");
const name = line.min(1);
export const Highlight = z.strictObject({ id: ClaimId.optional(), text: name });
export type Highlight = z.infer<typeof Highlight>;
export const Role = z.strictObject({
  id: Slug,
  title: name,
  organisation: line.optional(),
  location: line.optional(),
  period: line.optional(),
  highlights: z.array(Highlight),
});
export type Role = z.infer<typeof Role>;
export const Project = z.strictObject({
  id: Slug,
  name,
  period: line.optional(),
  purpose: line.optional(),
  links: z.array(z.string()),
  stack: z.array(line),
  relationship: Relationship.optional(),
  contribution: line.optional(),
  highlights: z.array(Highlight),
});
export type Project = z.infer<typeof Project>;
export const Education = z.strictObject({
  id: Slug,
  degree: name,
  institution: line.optional(),
  year: line.optional(),
  details: line.optional(),
});
export type Education = z.infer<typeof Education>;
export const Certification = z.strictObject({ id: Slug, name, status: line.optional() });
export type Certification = z.infer<typeof Certification>;
export const InfoView = z.object({
  /** SHA-256 of each source file; an empty string means the file is absent. */
  hash: z.object({ outline: z.string(), projects: z.string(), profile: z.string() }),
  profile: Profile,
  summary: z.object({ text: z.string() }),
  roles: z.array(Role),
  projects: z.array(Project),
  education: z.array(Education),
  certifications: z.array(Certification),
  other: z.array(z.object({ section: z.string(), title: z.string() })),
});
export type InfoView = z.infer<typeof InfoView>;
export const DeleteInfoRequest = z.strictObject({ baseHash: z.string() });
export type DeleteInfoRequest = z.infer<typeof DeleteInfoRequest>;
export const PutInfoSummaryRequest = DeleteInfoRequest.extend({
  text: z
    .string()
    .max(20_000)
    .refine((text) => !/\0|<!--|^\s*(?:#{1,6}\s|[-*]\s|`{3}|~{3})/m.test(text), "Expected summary prose"),
});
export type PutInfoSummaryRequest = z.infer<typeof PutInfoSummaryRequest>;

// PUT is a patch: omitted fields keep their original bytes. Empty optional text clears a field.
const roleFields = Role.omit({ id: true });
const projectFields = Project.omit({ id: true }).extend({ links: z.array(HttpUrl) });
const educationFields = Education.omit({ id: true });
const certificationFields = Certification.omit({ id: true });
export const CreateInfoRoleRequest = roleFields.extend({
  baseHash: z.string(),
  highlights: z.array(Highlight).default([]),
});
export type CreateInfoRoleRequest = z.infer<typeof CreateInfoRoleRequest>;
export const PutInfoRoleRequest = roleFields.partial().extend({ baseHash: z.string() });
export type PutInfoRoleRequest = z.infer<typeof PutInfoRoleRequest>;
export const CreateInfoProjectRequest = projectFields.extend({
  baseHash: z.string(),
  links: z.array(HttpUrl).default([]),
  stack: z.array(line).default([]),
  highlights: z.array(Highlight).default([]),
});
export type CreateInfoProjectRequest = z.infer<typeof CreateInfoProjectRequest>;
export const PutInfoProjectRequest = projectFields.partial().extend({ baseHash: z.string() });
export type PutInfoProjectRequest = z.infer<typeof PutInfoProjectRequest>;
export const CreateInfoEducationRequest = educationFields.extend({ baseHash: z.string() });
export type CreateInfoEducationRequest = z.infer<typeof CreateInfoEducationRequest>;
export const PutInfoEducationRequest = educationFields.partial().extend({ baseHash: z.string() });
export type PutInfoEducationRequest = z.infer<typeof PutInfoEducationRequest>;
export const CreateInfoCertificationRequest = certificationFields.extend({ baseHash: z.string() });
export type CreateInfoCertificationRequest = z.infer<typeof CreateInfoCertificationRequest>;
export const PutInfoCertificationRequest = certificationFields.partial().extend({ baseHash: z.string() });
export type PutInfoCertificationRequest = z.infer<typeof PutInfoCertificationRequest>;
