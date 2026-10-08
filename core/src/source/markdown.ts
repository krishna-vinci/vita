import { slugify } from "@vita/shared";

export interface SourceLine {
  text: string;
  ending: string;
}

// Retain line endings separately so adding outline anchors cannot normalize the file.
export function sourceLines(markdown: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  for (const match of markdown.matchAll(pattern)) {
    if (!match[0]) break;
    lines.push({ text: match[1] ?? "", ending: match[2] ?? "" });
  }
  return lines;
}

export function fenceStart(line: string): { marker: string; info: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  return match ? { marker: match[1] ?? "", info: (match[2] ?? "").trim() } : null;
}

export function fenceEnd(line: string, marker: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  const delimiter = match?.[1];
  return !!delimiter && delimiter[0] === marker[0] && delimiter.length >= marker.length;
}

export function heading(line: string, level: number): string | null {
  const match = /^(#{2,3})[ \t]+(.+?)\s*$/.exec(line);
  return match?.[1]?.length === level ? (match[2] ?? "").replace(/[ \t]+#+$/, "") : null;
}

export function bulletText(line: string): string | null {
  const match = /^\s*[-*][ \t]+(.*)$/.exec(line);
  return match ? (match[1] ?? "") : null;
}

const fillerWords = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

export function factId(title: string, text: string, used: Set<string>): string {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) => slugify(word))
    .filter((word) => !fillerWords.has(word))
    .slice(0, 4);
  return uniqueId(`${slugify(title)}-${words.join("-") || "fact"}`, used);
}

export function uniqueId(base: string, used: Set<string>, maxLength = 80): string {
  const stem = base.slice(0, maxLength).replace(/-+$/, "");
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `-${suffix++}`;
    candidate = `${stem.slice(0, maxLength - tail.length).replace(/-+$/, "")}${tail}`;
  }
  used.add(candidate);
  return candidate;
}
