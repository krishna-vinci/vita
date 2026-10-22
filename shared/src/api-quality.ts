import { z } from "zod";
import { FactQuestion } from "./review";

export const MissingFactsView = z.object({ questions: z.array(FactQuestion) });
export type MissingFactsView = z.infer<typeof MissingFactsView>;
export const FactsAnswerRequest = z.strictObject({
  answers: z
    .record(z.string().min(1).max(200), z.string().trim().min(1).max(20_000))
    .refine((answers) => Object.keys(answers).length <= 100),
});
export type FactsAnswerRequest = z.infer<typeof FactsAnswerRequest>;
export const FactsAnswerResult = MissingFactsView.extend({ shas: z.array(z.string().nullable()) });
export type FactsAnswerResult = z.infer<typeof FactsAnswerResult>;
export const PreviewResult = z.object({ url: z.string() });
export type PreviewResult = z.infer<typeof PreviewResult>;
