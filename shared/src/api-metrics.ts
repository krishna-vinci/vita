import { z } from "zod";
import { CommitSha, SourceProposal } from "./api";
import { ClaimId, Slug } from "./ids";

export const MetricQuestionId = z.string().min(1).max(200);
export const MetricQuestion = z.strictObject({
  id: MetricQuestionId,
  itemSlug: Slug,
  itemName: z.string().min(1),
  claimId: ClaimId.optional(),
  question: z.string().min(1),
  why: z.string().min(1),
});
export type MetricQuestion = z.infer<typeof MetricQuestion>;
export const MetricQuestionsRequest = z.strictObject({
  itemSlug: Slug.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
export type MetricQuestionsRequest = z.infer<typeof MetricQuestionsRequest>;
export const MetricQuestions = z.array(MetricQuestion);
export const AnswerMetricRequest = z.strictObject({
  questionId: MetricQuestionId,
  answer: z
    .string()
    .min(1)
    .max(20_000)
    .refine((value) => !!value.trim(), "Answer must not be blank"),
  claimId: ClaimId.optional(),
});
export type AnswerMetricRequest = z.infer<typeof AnswerMetricRequest>;
export const AnswerMetricResponse = SourceProposal;
export const DismissMetricRequest = z.strictObject({ questionId: MetricQuestionId });
export type DismissMetricRequest = z.infer<typeof DismissMetricRequest>;
export const DismissMetricResponse = z.object({ questions: MetricQuestions, sha: CommitSha });
