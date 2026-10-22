import type { Highlight, InfoView } from "@vita/shared";

/** Which source file a write needs the hash of. */
export type InfoFile = "outline" | "projects" | "profile";
export const fileOf = {
  summary: "outline",
  roles: "outline",
  education: "outline",
  certifications: "outline",
  projects: "projects",
  profile: "profile",
} as const satisfies Record<string, InfoFile>;

/** One editable "what you did" row. `k` only keys the React list; `id` is kept so edits stay attached. */
export interface HighlightRow {
  k: string;
  id?: string;
  text: string;
}
export const newKey = () => Math.random().toString(36).slice(2, 10);
export const rowsFrom = (highlights: Highlight[]): HighlightRow[] =>
  highlights.map((item) => ({ k: newKey(), ...(item.id ? { id: item.id } : {}), text: item.text }));
/** The list the server gets: trimmed, blank new rows dropped. Existing rows keep their id. */
export const highlightsFrom = (rows: HighlightRow[]): Highlight[] =>
  rows
    .filter((row) => row.text.trim() || row.id)
    .map((row) => ({ ...(row.id ? { id: row.id } : {}), text: row.text.trim() }));
/** An existing bullet that was emptied cannot be saved; the person should remove it instead. */
export const hasEmptyHighlight = (rows: HighlightRow[]) => rows.some((row) => row.id && !row.text.trim());

export interface LinkRow {
  k: string;
  text: string;
}
export const linkRowsFrom = (links: string[]): LinkRow[] => links.map((text) => ({ k: newKey(), text }));
/** Links the person typed without https:// still work. */
export function normalizeLink(text: string): string {
  const value = text.trim();
  return value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? `https://${value}` : value;
}
export const linksFrom = (rows: LinkRow[]): string[] => rows.map((row) => normalizeLink(row.text)).filter(Boolean);
export function isWebLink(link: string): boolean {
  try {
    const url = new URL(link);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}
export const linkLabel = (link: string) => link.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

// Dates are written the way the rest of the data is: "Mar 2024 – Present" or "2023–2026".
const ongoingWord = /^(present|now|current|ongoing|today)$/i;
export interface Dates {
  start: string;
  end: string;
  ongoing: boolean;
}
export function parsePeriod(period: string | undefined): Dates {
  const text = (period ?? "").trim();
  const parts = text.split(/\s*[–—]\s*|\s+-\s+|(?<=\d{4})-(?=\d{4})|\s+to\s+/i).map((part) => part.trim());
  const start = parts[0] ?? "";
  const end = parts.length > 1 ? parts.slice(1).join(" – ") : "";
  return ongoingWord.test(end) ? { start, end: "", ongoing: true } : { start, end, ongoing: false };
}
export function formatPeriod({ start, end, ongoing }: Dates): string {
  const from = start.trim();
  if (!from) return ongoing ? "Present" : end.trim();
  if (ongoing) return `${from} – Present`;
  return end.trim() ? `${from} – ${end.trim()}` : from;
}

export type Missing = "dates" | "purpose" | "year";
export interface MissingItem {
  /** Card key, e.g. `project:my-app`. */
  card: string;
  field: "period" | "purpose" | "year";
  kind: Missing;
  name: string;
}
/** What would make resumes stronger: only gaps the person can fill in a minute. */
export function missingItems(view: InfoView): MissingItem[] {
  const items: MissingItem[] = [];
  for (const project of view.projects) {
    if (!project.period?.trim())
      items.push({ card: `project:${project.id}`, field: "period", kind: "dates", name: project.name });
    if (!project.purpose?.trim())
      items.push({ card: `project:${project.id}`, field: "purpose", kind: "purpose", name: project.name });
  }
  for (const entry of view.education)
    if (!entry.year?.trim())
      items.push({ card: `education:${entry.id}`, field: "year", kind: "year", name: entry.degree });
  return items;
}
export const missingText = (item: MissingItem) =>
  item.kind === "dates"
    ? `${item.name}: add dates`
    : item.kind === "purpose"
      ? `${item.name}: add a one-line purpose`
      : `${item.name}: add the year`;

export const fieldId = (card: string, field: string) => `${card.replace(/[^a-zA-Z0-9_-]/g, "-")}-${field}`;
