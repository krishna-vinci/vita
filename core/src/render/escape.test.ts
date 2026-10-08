import { describe, expect, it } from "vitest";
import { latexEscape } from "./escape";

describe("latexEscape", () => {
  it("escapes every special character without escaping generated commands twice", () => {
    expect(latexEscape("\\ & % $ # _ { } ~ ^")).toBe(
      "\\textbackslash{} \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{}",
    );
  });

  it("converts Unicode quotes and dashes and turns newlines into spaces", () => {
    expect(latexEscape("“double” ‘single’ – —\nnext\r\nlast\rend")).toBe("``double'' `single' -- --- next last end");
  });
});
