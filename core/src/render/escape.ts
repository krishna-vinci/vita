const escapes: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "“": "``",
  "”": "''",
  "‘": "`",
  "’": "'",
  "–": "--",
  "—": "---",
};

export function latexEscape(s: string): string {
  return s.replace(/\r\n|[\\&%$#_{}~^“”‘’–—\r\n]/g, (character) => escapes[character] ?? " ");
}

/** Escapes href targets without turning URL punctuation into visible text commands. */
export function latexUrlEscape(value: string): string {
  return value.replace(/[\\%#{}]/g, (character) => (character === "\\" ? "%5C" : `\\${character}`));
}
