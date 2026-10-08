export interface ProjectCard {
  title: string;
  kind: string;
  period: string;
  facts: number;
  evidence: number;
  variants: number;
  limits: string[];
  checkedAt: string;
}

function section(body: string, heading: string): string {
  const match = new RegExp(`^### ${heading}\\s*$([\\s\\S]*?)(?=^###? |(?![\\s\\S]))`, "m").exec(body);
  return match?.[1] ?? "";
}
const bullets = (text: string) => [...text.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1] ?? "");

/** A light read of projects.md for the list view; the file itself stays the source of truth. */
export function parseProjects(markdown: string): ProjectCard[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [first = "", ...rest] = chunk.split("\n");
      const body = rest.join("\n");
      const field = (name: string) => new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, "m").exec(body)?.[1]?.trim() ?? "";
      return {
        title: first.trim(),
        kind: field("kind"),
        period: field("period"),
        facts: (body.match(/<!--\s*c:/g) ?? []).length,
        evidence: (body.match(/^\s*-\s+id:\s*ev-/gm) ?? []).length,
        variants: bullets(section(body, "Variants")).length,
        limits: bullets(section(body, "Limits")),
        checkedAt: /verified:\s*\n\s+at:\s*"?([^"\n]+)"?/.exec(body)?.[1]?.trim() ?? "",
      };
    });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
