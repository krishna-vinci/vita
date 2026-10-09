import { answerMetric, dismissMetric, MetricInterviewError, metricQuestions } from "@vita/core";
import { AnswerMetricRequest, DismissMetricRequest, MetricQuestionsRequest } from "@vita/shared";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let input: unknown;
  try {
    input = await c.req.json();
  } catch {
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
  return schema.parse(input);
}

export function metricsRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const exclusive = <T>(action: () => Promise<T>) =>
    runtime.exclusive(async () => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof MetricInterviewError)
          throw new ApiFailure(error.code === "invalid-question" ? 404 : 422, error.code, error.message);
        throw error;
      }
    });
  app.get("/questions", async (c) => {
    const limit = c.req.query("limit");
    const input = MetricQuestionsRequest.parse({
      itemSlug: c.req.query("itemSlug"),
      limit: limit === undefined ? undefined : Number(limit),
    });
    return exclusive(async () => c.json(await metricQuestions(runtime.ws, input)));
  });
  app.post("/answer", async (c) => {
    const input = await body(c, AnswerMetricRequest);
    return exclusive(async () => c.json(await answerMetric(runtime.ws, input)));
  });
  app.post("/dismiss", async (c) => {
    const { questionId } = await body(c, DismissMetricRequest);
    return exclusive(async () => {
      const result = await dismissMetric(runtime.ws, questionId);
      if (result.sha) runtime.changed("settings", result.sha);
      return c.json({ ...result, questions: await metricQuestions(runtime.ws, {}) });
    });
  });
  return app;
}
