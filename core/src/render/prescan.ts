export interface PrescanIssue {
  line: number;
  message: string;
}

function withoutComments(source: string): string {
  return source.replace(/\\[^a-zA-Z@]|%[^\r\n]*/g, (token) =>
    token.startsWith("%") ? " ".repeat(token.length) : token,
  );
}

function pathArgument(source: string, offset: number): string | undefined {
  let rest = source.slice(offset).trimStart();
  while (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end < 0) return undefined;
    rest = rest.slice(end + 1).trimStart();
  }
  if (rest.startsWith("{")) {
    const end = rest.indexOf("}");
    return end < 0 ? undefined : rest.slice(1, end).trim();
  }
  return rest.match(/^[^\s%{}]+/)?.[0];
}

export function prescanTex(source: string): PrescanIssue[] {
  const clean = withoutComments(source);
  const issues: PrescanIssue[] = [];
  const add = (offset: number, message: string) => {
    issues.push({ line: clean.slice(0, offset).split("\n").length, message });
  };
  // TeX's ^^ character decoding can hide control sequences from a lexical scan.
  for (const match of clean.matchAll(/\^\^/g)) add(match.index, "TeX character decoding is not allowed");
  const guards: { primitive?: string; active: boolean }[] = [];
  const commands = /\\([a-zA-Z@]+|[^a-zA-Z@])/g;
  const pdfPrimitives = new Set(["pdfgentounicode", "pdfoutput", "pdfminorversion"]);
  for (let match = commands.exec(clean); match; match = commands.exec(clean)) {
    const command = match[1] ?? "";
    if (command === "ifdefined") {
      const target = /^\s*\\([a-zA-Z@]+)/.exec(clean.slice(commands.lastIndex));
      guards.push({ primitive: target?.[1], active: true });
      if (target) commands.lastIndex += target[0].length;
      continue;
    }
    if (command.startsWith("if")) guards.push({ active: true });
    if (command === "else" && guards.length) {
      const guard = guards[guards.length - 1];
      if (guard) guard.active = !guard.active;
    }
    if (command === "fi") guards.pop();
    const guarded = (primitive: string) => guards.some((guard) => guard.active && guard.primitive === primitive);
    if (pdfPrimitives.has(command) && !guarded(command)) {
      add(match.index, `pdfTeX-only primitive \\${command} requires an \\ifdefined guard`);
    }
    if (["write", "openout", "openin", "read", "directlua", "ShellEscape", "catcode", "csname"].includes(command)) {
      add(match.index, `Unsafe command \\${command}`);
    }
    if (["input", "include", "includegraphics"].includes(command)) {
      const path = pathArgument(clean, commands.lastIndex);
      if (
        !path ||
        /^(?:[/\\]|[a-zA-Z]:|\||~)/.test(path) ||
        path.includes("..") ||
        /[\\{}#]/.test(path) ||
        [...path].some((character) => character.charCodeAt(0) < 32)
      ) {
        add(match.index, `Unsafe or dynamic path in \\${command}`);
      }
      if (path?.includes("glyphtounicode") && !guarded("pdfgentounicode")) {
        add(match.index, "pdfTeX-only glyphtounicode requires an \\ifdefined guard");
      }
    }
    if (command === "usepackage" || command === "RequirePackage") {
      const packages = pathArgument(clean, commands.lastIndex);
      if (packages?.split(",").some((name) => name.trim() === "shellesc")) {
        add(match.index, "The shellesc package is not allowed");
      }
    }
  }
  return issues;
}
