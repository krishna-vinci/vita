import { expect, it } from "vitest";
import { ApiResumeOp } from "./api";
import { FitRequest, FitResponse, FitScope } from "./api-fit";

it("validates fit inputs and both resource scopes", () => {
  expect(FitRequest.parse({})).toEqual({});
  expect(FitRequest.parse({ maxPages: 1, relevance: { line: 0.2 } })).toEqual({
    maxPages: 1,
    relevance: { line: 0.2 },
  });
  for (const maxPages of [0, -1, 1.5]) expect(FitRequest.safeParse({ maxPages }).success).toBe(false);
  expect(FitRequest.safeParse({ apply: true }).success).toBe(false);
  expect(FitScope.parse("resumes")).toBe("resumes");
  expect(FitScope.parse("applications")).toBe("applications");
  expect(FitScope.safeParse("outline").success).toBe(false);
});

it("returns only layout and hide operations compatible with the existing ops API", () => {
  const ops = FitResponse.parse([
    { op: "layout.set", key: "line_spread", value: 0.9 },
    { op: "bullet.hide", id: "line", hidden: true },
  ]);
  for (const op of ops) expect(ApiResumeOp.parse(op)).toEqual(op);
  expect(FitResponse.parse([])).toEqual([]);
  expect(FitResponse.safeParse([{ op: "bullet.hide", id: "line", hidden: false }]).success).toBe(false);
  expect(FitResponse.safeParse([{ op: "bullet.edit", id: "line", text: "Changed" }]).success).toBe(false);
});
