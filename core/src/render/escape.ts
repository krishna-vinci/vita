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
