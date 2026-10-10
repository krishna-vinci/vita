import { z } from "zod";
import { Slug } from "./ids";

export const TrackerStatus = z.enum([
  "draft",
  "ready",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
]);
export type TrackerStatus = z.infer<typeof TrackerStatus>;
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const text = z.string().max(20_000);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const TrackerEventInput = z.strictObject({
  date,
  kind: z.string().trim().min(1).max(100),
  notes: text.default(""),
  questions: z.array(z.string().trim().min(1).max(4000)).max(100).default([]),
});
export type TrackerEventInput = z.infer<typeof TrackerEventInput>;
export const TrackerEvent = TrackerEventInput.extend({ id: Slug, at: date });
export const TrackerFollowUpInput = z.strictObject({
  due: date,
  text: z.string().trim().min(1).max(4000),
  done: z.boolean().default(false),
});
export type TrackerFollowUpInput = z.infer<typeof TrackerFollowUpInput>;
export const TrackerFollowUp = TrackerFollowUpInput.extend({ id: Slug });
export const TrackerContact = z.strictObject({
  name: z.string().min(1).max(1000),
  role: text.default(""),
  channel: text.default(""),
  notes: text.default(""),
});
export const TrackerOutcome = z.strictObject({ summary: text, reasons: z.array(text).default([]) });
export const SentVersion = z.strictObject({ resume: sha, letter: sha.optional(), at: date });
export const Tracker = z.strictObject({
  status: TrackerStatus.default("draft"),
  history: z.array(z.strictObject({ status: TrackerStatus, at: date, note: text.default("") })).default([]),
  appliedAt: date.optional(),
  source: text.default(""),
  link: z.url().optional(),
  contacts: z.array(TrackerContact).default([]),
  events: z.array(TrackerEvent).default([]),
  followUps: z.array(TrackerFollowUp).default([]),
  outcome: TrackerOutcome.optional(),
  sentVersions: z.array(SentVersion).default([]),
  updatedAt: date.optional(),
});
export type Tracker = z.infer<typeof Tracker>;
export const PutTrackerRequest = z.strictObject({
  status: TrackerStatus.optional(),
  note: text.optional(),
  appliedAt: date.optional(),
  source: text.optional(),
  link: z.url().nullable().optional(),
  contacts: z.array(TrackerContact).max(100).optional(),
  followUps: z.array(TrackerFollowUp).max(1000).optional(),
  outcome: TrackerOutcome.nullable().optional(),
});
export type PutTrackerRequest = z.infer<typeof PutTrackerRequest>;
export const SentRequest = z.strictObject({ resume: sha.optional(), letter: sha.optional() });
export type SentRequest = z.infer<typeof SentRequest>;
export const TrackerDerived = z.object({
  nextFollowUpDue: date.nullable(),
  daysSinceLastActivity: z.number().int().nonnegative(),
  stale: z.boolean(),
});
export const TrackerItem = z.object({ id: Slug, tracker: Tracker, derived: TrackerDerived });
export const TrackerList = z.object({
  applications: z.array(TrackerItem),
  funnel: z.record(TrackerStatus, z.number().int().nonnegative()),
});
