import { expect, it } from "vitest";
import { changedLines } from "./diff";

it("keeps only the lines that differ", () => {
  expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual({ before: "b", after: "B", context: true });
  expect(changedLines("a\nc", "a\nnew\nc")).toEqual({ before: "", after: "new", context: true });
  expect(changedLines("x", "y")).toEqual({ before: "x", after: "y", context: false });
});
