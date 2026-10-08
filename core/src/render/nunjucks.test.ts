import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTexEnv } from "./nunjucks";

it("escapes all variable output, permits raw, and leaves HTML characters alone", () => {
  const env = createTexEnv(".");
  expect(env.renderString("((( x ))) / ((( x | raw )))", { x: "A & B_ <tag>" })).toBe(
    "A \\& B\\_ <tag> / A & B_ <tag>",
  );
  expect(env.renderString("((( x | upper | safe )))", { x: "a&b" })).toBe("A\\&B");
  expect(env.renderString('((( values | join(" & ") )))', { values: ["A", "B"] })).toBe("A \\& B");
});

it("throws on undefined output and handles quoted delimiters, blocks and comments", () => {
  const env = createTexEnv(".");
  expect(() => env.renderString("((( missing )))", {})).toThrow(/undefined/);
  expect(() => env.renderString("((( missing | raw )))", {})).toThrow(/undefined/);
  expect(env.renderString('((= ignored =))((* if true *))((( "a)))b&" )))((* endif *))', {})).toBe("a)))b\\&");
  expect(env.renderString('((( {"x": "&"}.x )))', {})).toBe("\\&");
  expect(env.renderString('((( (values | join("&")) )))', { values: ["A", "B"] })).toBe("A\\&B");
});

it("preserves literal LaTeX braces and escapes a value inside a LaTeX command", () => {
  const env = createTexEnv(".");
  expect(env.renderString("\\textbf{((( name )))}", { name: "Alex & Co_" })).toBe("\\textbf{Alex \\& Co\\_}");
  const literal = "\\begin{itemize}\\item x\\end{itemize}\n{\\Huge\\bfseries x}";
  expect(env.renderString(literal, {})).toBe(literal);
});

it("escapes outputs in included templates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vita-nunjucks-test-"));
  try {
    await mkdir(join(dir, "partials"));
    await writeFile(join(dir, "partials/value.njk"), "\\textbf{((( x )))}");
    const env = createTexEnv(dir);
    expect(env.renderString('((* include "partials/value.njk" *))', { x: "&" })).toBe("\\textbf{\\&}");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
