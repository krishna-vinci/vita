import { Relationship } from "@vita/shared";

export interface ProjectCard {
  title: string;
  kind: string;
  period: string;
  facts: number;
  evidence: number;
  variants: number;
  limits: string[];
  checkedAt: string;
  /** The full github.com URL found in the project's section, or "". */
  repoUrl: string;
  relationship?: Relationship;
  contribution: string;
}

const githubUrl = /https?:\/\/github\.com\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*/;

/** "owner/name" for a github.com repository URL, or undefined for anything else. */
export function githubRepo(url: string): string | undefined {
  const match = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/.exec(url.trim());
  if (!match) return undefined;
  return `${match[1]}/${(match[2] ?? "").replace(/\.git$/, "")}`;
}

function section(body: string, heading: string): string {
  const match = new RegExp(`^### ${heading}\\s*$([\\s\\S]*?)(?=^###? |(?![\\s\\S]))`, "m").exec(body);
  return match?.[1] ?? "";
}
const bullets = (text: string) => [...text.matchAll(/^\s*-\s+(.+)$/gm)].map((match) => match[1] ?? "");

function parseQuoted(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/** A light read of projects.md for the list view; the file itself stays the source of truth. */
export function parseProjects(markdown: string): ProjectCard[] {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [first = "", ...rest] = chunk.split("\n");
      const body = rest.join("\n");
      const field = (name: string) => new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, "m").exec(body)?.[1]?.trim() ?? "";
      const relationship = Relationship.safeParse(field("relationship"));
      const contribution = /^contribution:\s*(".*")\s*$/m.exec(body)?.[1];
      return {
        title: first.trim(),
        kind: field("kind"),
        period: field("period"),
        facts: (body.match(/<!--\s*c:/g) ?? []).length,
        evidence: (body.match(/^\s*-\s+id:\s*ev-/gm) ?? []).length,
        variants: bullets(section(body, "Variants")).length,
        limits: bullets(section(body, "Limits")),
        checkedAt: /verified:\s*\n\s+at:\s*"?([^"\n]+)"?/.exec(body)?.[1]?.trim() ?? "",
        repoUrl: githubUrl.exec(body)?.[0] ?? "",
        relationship: relationship.success ? relationship.data : undefined,
        contribution: parseQuoted(contribution),
      };
    });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
