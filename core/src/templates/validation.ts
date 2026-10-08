import { AdoptionProposal, TemplateMeta } from "@vita/shared";
import nunjucks from "nunjucks";
import { parse } from "yaml";
import { scanTex } from "./compile.js";
import { TemplateError } from "./zip.js";

export function validateProposal(proposal: AdoptionProposal, original: string): TemplateMeta {
  AdoptionProposal.parse(proposal);
  const meta = TemplateMeta.parse(parse(proposal.templateYaml));
  const source = proposal.mainTexNjk;
  if (!source.includes("(((") || /\{%|\{\{\s*(?:header|sections|layout)\b/.test(source))
    throw new TemplateError(
      "invalid-proposal",
      "Use nbconvert delimiters: ((( values ))), ((* tags *)), ((= comments =))",
    );
  // Validate the parsed language, not substring matches: quoted delimiters cannot hide executable nodes.
  interface Node {
    typename: string;
    value?: unknown;
    val?: Node;
    name?: Node;
    [key: string]: unknown;
  }
  const parser = (
    nunjucks as unknown as { parser: { parse(source: string, extensions: unknown[], options: unknown): Node } }
  ).parser;
  let tree: Node;
  try {
    tree = parser.parse(source, [], {
      tags: {
        variableStart: "(((",
        variableEnd: ")))",
        blockStart: "((*",
        blockEnd: "*))",
        commentStart: "((=",
        commentEnd: "=))",
      },
    });
  } catch (error) {
    throw new TemplateError("invalid-proposal", `Invalid template syntax: ${String(error)}`);
  }
  const allowed = new Set([
    "Root",
    "NodeList",
    "Output",
    "TemplateData",
    "Literal",
    "Symbol",
    "LookupVal",
    "Filter",
    "For",
    "If",
    "Compare",
    "CompareOperand",
    "And",
    "Or",
    "Not",
    "Add",
    "Sub",
    "Mul",
    "Div",
    "FloorDiv",
    "Mod",
    "Neg",
    "Pos",
    "InlineIf",
  ]);
  const unsafe = (value: unknown) =>
    typeof value === "string" && (value.startsWith("_") || ["constructor", "prototype"].includes(value));
  let nodes = 0;
  const visit = (value: unknown, loops: number): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child, loops);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Node;
    if (!allowed.has(node.typename) || ++nodes > 20_000)
      throw new TemplateError("invalid-proposal", "Unsupported template operation");
    if (node.typename === "For") loops++;
    if (loops > 4) throw new TemplateError("invalid-proposal", "Too many nested template loops");
    if (node.typename === "Symbol" && unsafe(node.value))
      throw new TemplateError("invalid-proposal", "Unsafe template name");
    if (node.typename === "LookupVal" && (node.val?.typename !== "Literal" || unsafe(node.val.value)))
      throw new TemplateError("invalid-proposal", "Unsafe or dynamic template property");
    if (
      node.typename === "Filter" &&
      !["join", "default", "length", "latex", "escape"].includes(String(node.name?.value))
    )
      throw new TemplateError("invalid-proposal", "Unsupported template filter");
    for (const child of Object.values(node)) visit(child, loops);
  };
  visit(tree, 0);
  const originalLines = original
    .split(/\r?\n/)
    .filter((line) => /\\(?:usepackage|newcommand)\b/.test(line.replace(/(?<!\\)%.*$/, "")));
  const lines = source.split(/\r?\n/);
  for (const line of originalLines) {
    const index = lines.indexOf(line);
    if (index < 0) throw new TemplateError("layout-changed", `Preserve the original layout line: ${line}`);
    lines.splice(index, 1);
  }
  scanTex(source, "main.tex.njk");
  return meta;
}
