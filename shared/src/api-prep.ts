import { z } from "zod";

export const PrepQuestion = z.object({
  id: z.string(),
  kind: z.enum(["technical", "behavioral", "system-design", "gap", "company"]),
  question: z.string(),
  why: z.string(),
  talkingPoints: z.array(z.string()),
  claimIds: z.array(z.string()),
});
export type PrepQuestion = z.infer<typeof PrepQuestion>;

export const StoryDraft = z.object({
  id: z.string(),
  title: z.string(),
  situation: z.string(),
  task: z.string(),
  action: z.string(),
  result: z.string().nullable(),
  claimIds: z.array(z.string()),
});
export type StoryDraft = z.infer<typeof StoryDraft>;

export const GapAnswer = z.object({
  requirementId: z.string(),
  honestAnswer: z.string(),
  bridge: z.string(),
  plan: z.string(),
});
export type GapAnswer = z.infer<typeof GapAnswer>;

export const Prep = z.object({
  questions: z.array(PrepQuestion),
  stories: z.array(StoryDraft),
  gaps: z.array(GapAnswer),
});
export type Prep = z.infer<typeof Prep>;
