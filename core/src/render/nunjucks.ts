import nunjucks from "nunjucks";
import { latexEscape } from "./escape";

class RawTex {
  constructor(readonly value: string) {}
}

// Wrap expressions, rather than context values, so joined and calculated values
// are escaped too. Quoted delimiters stay literal.
function escapeOutputs(source: string): string {
  let output = "";
  let offset = 0;
  const starts = /\(\((\(|\*|=)/g;
  while (offset < source.length) {
    starts.lastIndex = offset;
    const tag = starts.exec(source);
    if (!tag) return output + source.slice(offset);
    output += source.slice(offset, tag.index);
    const start = starts.lastIndex;
    const ending = tag[1] === "(" ? ")))" : tag[1] === "*" ? "*))" : "=))";
    let end = start;
    let quote = "";
    let depth = 0;
    for (; end < source.length; end++) {
      const character = source[end] ?? "";
      if (quote) {
        if (character === "\\") end++;
        else if (character === quote) quote = "";
      } else if (depth === 0 && source.startsWith(ending, end)) {
        break;
      } else if (tag[1] !== "=" && (character === '"' || character === "'")) {
        quote = character;
      } else if (tag[1] !== "=" && "([{".includes(character)) {
        depth++;
      } else if (tag[1] !== "=" && ")]}".includes(character)) {
        depth--;
      }
    }
    if (end === source.length) return output + source.slice(tag.index);
    const expression = source.slice(start, end);
    output += tag[1] === "(" ? `((( (${expression}) | latex )))` : source.slice(tag.index, end + ending.length);
    offset = end + ending.length;
  }
  return output;
}

class LatexOutputs implements nunjucks.Extension {
  tags: string[] = [];
  preprocess = escapeOutputs;

  parse(): never {
    throw new Error("LatexOutputs only preprocesses variable output");
  }
}

export function createTexEnv(searchPath: string): nunjucks.Environment {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(searchPath, { noCache: true }), {
    autoescape: false,
    trimBlocks: true,
    lstripBlocks: true,
    throwOnUndefined: true,
    tags: {
      blockStart: "((*",
      blockEnd: "*))",
      variableStart: "(((",
      variableEnd: ")))",
      commentStart: "((=",
      commentEnd: "=))",
    },
  });
  env.addFilter("raw", (value: unknown) => (value == null ? value : new RawTex(String(value))));
  env.addFilter("latex", (value: unknown) => {
    if (value == null) return value;
    return value instanceof RawTex ? value.value : latexEscape(String(value));
  });
  env.addExtension("latexOutputs", new LatexOutputs());
  return env;
}
