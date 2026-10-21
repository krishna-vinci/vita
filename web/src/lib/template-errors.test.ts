import { expect, it } from "vitest";
import { errorLinesOf, texLinesOf } from "./template-errors";

it("reads line numbers from validation messages", () => {
  expect(errorLinesOf("main.tex.njk:12: bad tag\nmain.tex.njk:4: other\nInvalid syntax Line 12")).toEqual([4, 12]);
  expect(errorLinesOf("Something else")).toEqual([]);
});

it("reads line numbers from LaTeX compile messages", () => {
  expect(texLinesOf("error: main.tex:41: Undefined color\nmain.tex.njk:2: x")).toEqual([2, 41]);
});
