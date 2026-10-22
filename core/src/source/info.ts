import { createHash, randomUUID } from "node:crypto";
import {
  type Certification,
  CreateInfoCertificationRequest,
  CreateInfoEducationRequest,
  CreateInfoProjectRequest,
  CreateInfoRoleRequest,
  DeleteInfoRequest,
  type Education,
  type Evidence,
  type Highlight,
  type InfoView,
  Profile,
  type Project,
  PutInfoCertificationRequest,
  PutInfoEducationRequest,
  PutInfoProjectRequest,
  PutInfoRoleRequest,
  PutInfoSummaryRequest,
  type Role,
  Slug,
  type SourceProposal,
  slugify,
} from "@vita/shared";
import { parse, stringify } from "yaml";
import { ChatConflictError } from "../chat/context.js";
import { loadRules } from "../instructions/rules.js";
import { localDate } from "../pipeline/date.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { commitPaths, FileLocks, fileHash, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { readAnchor } from "./anchors.js";
import { appendEvidence } from "./chat-edits.js";
import { applySourceEdit } from "./edit.js";
import { bulletText, fenceEnd, fenceStart, sourceLines } from "./markdown.js";
import { parseOutline, summarySectionNames } from "./outline.js";
import { parseProjects } from "./projects.js";
import { projectMetadataProposal } from "./relationship.js";

const emptyEdits = new FileLocks();

export type InfoCollection = "roles" | "projects" | "education" | "certifications";
export class InfoSourceError extends Error {
  constructor(
    public readonly code: "not-found" | "ambiguous" | "invalid-source",
    message: string,
  ) {
    super(message);
  }
}

// Section vocabulary is data, independent of any profession.
const sectionNames = {
  roles: ["experience", "work", "employment", "roles", "positions"],
  education: ["education", "training", "qualifications", "professional development"],
  certifications: ["certifications", "certification", "licences", "licenses"],
};
const sectionTitle = { roles: "Experience", education: "Education", certifications: "Certifications" };
type OutlineCollection = Exclude<InfoCollection, "projects">;
type OutlineValue = Role | Education | Certification;
type SourceLine = ReturnType<typeof sourceLines>[number];
interface Field {
  line: number;
  start: number;
  end: number;
}
interface Entry {
  collection: OutlineCollection;
  id: string;
  section: string;
  sectionLine: number;
  start: number;
  end: number;
  fields: Record<string, Field>;
  value: OutlineValue;
  bullets: { line: number; id?: string; text: string }[];
  heading: boolean;
  pipe: boolean;
}
interface Change {
  start: number;
  end: number;
  text: string;
}
const plain = (text: string) =>
  readAnchor(text)
    .text.replace(/\*\*|(?<!\*)\*(?!\*)/g, "")
    .trim();
const isPeriod = (text: string) =>
  /^(?:(?:expected|graduating)\s+)?(?:19|20)\d{2}(?:\s*[–—-]\s*(?:(?:19|20)\d{2}|present|current))?$/i.test(
    plain(text),
  );
function matches(title: string, names: string[]) {
  return names.some((name) => new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`, "i").test(title));
}
function outsideFences(lines: SourceLine[]): Set<number> {
  const result = new Set<number>();
  let fence: string | undefined;
  lines.forEach(({ text }, index) => {
    if (fence) {
      if (fenceEnd(text, fence)) fence = undefined;
    } else {
      const start = fenceStart(text);
      if (start) fence = start.marker;
      else result.add(index);
    }
  });
  return result;
}
function token(line: number, text: string, start: number, end: number): Field {
  const raw = text.slice(start, end);
  const lead = /^\s*/.exec(raw)?.[0].length ?? 0;
  const trail = /\s*$/.exec(raw)?.[0].length ?? 0;
  const trimmed = raw.trim();
  const mark =
    trimmed.length >= 4 && trimmed.startsWith("**") && trimmed.endsWith("**")
      ? 2
      : trimmed.length >= 2 && trimmed.startsWith("*") && trimmed.endsWith("*")
        ? 1
        : 0;
  return { line, start: start + lead + mark, end: Math.max(start + lead + mark, end - trail - mark) };
}
function fieldText(lines: SourceLine[], field: Field) {
  return lines[field.line]?.text.slice(field.start, field.end) ?? "";
}
function scanOutline(markdown: string) {
  const outline = parseOutline(markdown);
  const lines = sourceLines(markdown);
  const visible = outsideFences(lines);
  const entries: Entry[] = [];
  const other: InfoView["other"] = [];
  const summary = outline.sections.find((s) => summarySectionNames.includes(plain(s.title).toLowerCase()));
  for (const [position, section] of outline.sections.entries()) {
    if (section === summary) continue;
    const start = section.line;
    const end = (outline.sections[position + 1]?.line ?? lines.length + 1) - 1;
    const candidates = [...visible].filter(
      (i) => i >= start && i < end && /^(?:###\s+|\*\*[^*]+\*\*)/.test(lines[i]?.text ?? ""),
    );
    const roleSection = matches(section.title, sectionNames.roles);
    const eduSection = matches(section.title, sectionNames.education);
    const certSection = matches(section.title, sectionNames.certifications);
    if (!roleSection && !eduSection && !certSection) {
      other.push({ section: plain(section.title), title: plain(section.title) });
      for (const entry of section.entries) other.push({ section: plain(section.title), title: plain(entry.title) });
      continue;
    }
    const consumed = new Set<number>();
    for (const [index, at] of candidates.entries()) {
      const text = lines[at]?.text ?? "";
      const entryEnd = candidates[index + 1] ?? end;
      const heading = text.startsWith("###");
      const contentStart = heading ? (/^###\s+/.exec(text)?.[0].length ?? 4) : 0;
      const contentEnd = readAnchor(text).anchor ? text.lastIndexOf("<!--") : text.length;
      const content = text.slice(contentStart, contentEnd);
      const pipe = roleSection && content.includes(" | ");
      const separator = pipe ? /\s+\|\s+/g : /\s+—\s+|\s+-\s+/g;
      const parts: Field[] = [];
      let cursor = contentStart;
      for (const match of content.matchAll(separator)) {
        const split = contentStart + (match.index ?? 0);
        parts.push(token(at, text, cursor, split));
        cursor = split + match[0].length;
      }
      parts.push(token(at, text, cursor, contentEnd));
      const get = (i: number) => (parts[i] ? plain(fieldText(lines, parts[i])) : "");
      const nextBody = [...visible].find(
        (i) => i > at && i < entryEnd && lines[i]?.text.trim() && !/^Location: /.test(lines[i]?.text ?? ""),
      );
      const periodField =
        nextBody !== undefined && isPeriod(lines[nextBody]?.text ?? "")
          ? token(nextBody, lines[nextBody]?.text ?? "", 0, lines[nextBody]?.text.length ?? 0)
          : undefined;
      const collection: OutlineCollection = roleSection
        ? "roles"
        : certSection &&
            (!eduSection ||
              /\b(?:certificate|certification|certified|licence|license)\b/i.test(get(0)) ||
              /^(?:pursuing|in progress|pending|expected|(?:19|20)\d{2})\b/i.test(get(1)))
          ? "certifications"
          : "education";
      const fields: Record<string, Field> = {};
      let values: Record<string, unknown>;
      if (collection === "roles") {
        if (pipe && (parts.length < 2 || parts.length > 4)) continue;
        if (!pipe && parts.length > 2) continue;
        if (pipe) {
          fields.title = parts[0] as Field;
          if (parts.length === 4) fields.organisation = parts[1] as Field;
          fields.location = parts[parts.length - 2] as Field;
          fields.period = parts[parts.length - 1] as Field;
          if (parts.length === 2) delete fields.location;
        } else {
          fields.title = parts[heading && parts.length === 2 ? 1 : 0] as Field;
          if (parts.length === 2) fields.organisation = parts[heading ? 0 : 1] as Field;
          if (periodField) fields.period = periodField;
        }
        values = { title: plain(fieldText(lines, fields.title as Field)) };
        for (const key of ["organisation", "location", "period"])
          if (fields[key]) values[key] = plain(fieldText(lines, fields[key]));
      } else {
        if (parts.length > 3) continue;
        const first = collection === "education" ? "degree" : "name";
        fields[first] = parts[0] as Field;
        values = { [first]: get(0) };
        if (collection === "education") {
          if (parts[1]) {
            const institution = parts[1];
            const value = fieldText(lines, institution);
            const year = /(?:\s*[,|]\s*|\s+\()((?:19|20)\d{2}(?:\s*[–—-]\s*(?:19|20)\d{2})?)\)?$/.exec(value);
            if (isPeriod(value)) {
              fields.year = institution;
              values.year = plain(value);
            } else if (year) {
              fields.institution = { ...institution, end: institution.start + (year.index ?? 0) };
              fields.year = {
                ...institution,
                start: institution.start + value.lastIndexOf(year[1] ?? ""),
                end: institution.start + value.lastIndexOf(year[1] ?? "") + (year[1]?.length ?? 0),
              };
              values.institution = fieldText(lines, fields.institution);
              values.year = year[1];
            } else {
              fields.institution = institution;
              values.institution = get(1);
            }
          }
          if (parts[2] || periodField) {
            fields.year = (parts[2] ?? periodField) as Field;
            values.year = plain(fieldText(lines, fields.year));
          }
          const detail = [...visible].find(
            (i) =>
              i > at &&
              i < entryEnd &&
              i !== periodField?.line &&
              lines[i]?.text.trim() &&
              bulletText(lines[i]?.text ?? "") === null,
          );
          if (detail !== undefined) {
            fields.details = token(detail, lines[detail]?.text ?? "", 0, lines[detail]?.text.length ?? 0);
            values.details = plain(fieldText(lines, fields.details));
          }
        } else {
          if (parts[1] && !periodField) {
            fields.status = parts[1];
            values.status = get(1);
          } else if (periodField) {
            fields.status = periodField;
            values.status = plain(fieldText(lines, periodField));
          }
        }
      }
      if (collection === "roles") {
        const locationLine = [...visible].find(
          (i) => i > at && i < entryEnd && /^Location: /.test(lines[i]?.text ?? ""),
        );
        if (locationLine !== undefined) {
          fields.location = token(
            locationLine,
            lines[locationLine]?.text ?? "",
            10,
            lines[locationLine]?.text.length ?? 0,
          );
          values.location = fieldText(lines, fields.location);
        }
      }
      const bullets = [...visible]
        .filter((i) => i > at && i < entryEnd && bulletText(lines[i]?.text ?? "") !== null)
        .map((line) => {
          const parsed = readAnchor(bulletText(lines[line]?.text ?? "") ?? "");
          return { line, id: parsed.anchor?.claim, text: parsed.text };
        });
      const id = slugify(
        collection === "roles" && values.organisation
          ? `${values.organisation}-${values.title}`
          : String(values.title ?? values.degree ?? values.name),
      );
      if (collection === "roles") values.highlights = bullets.map(({ id, text }) => ({ ...(id ? { id } : {}), text }));
      const value = { id, ...values } as OutlineValue;
      entries.push({
        collection,
        id,
        section: plain(section.title),
        sectionLine: section.line - 1,
        start: at,
        end: entryEnd,
        fields,
        value,
        bullets,
        heading,
        pipe,
      });
      consumed.add(at);
      for (const field of Object.values(fields)) consumed.add(field.line);
      if (collection === "roles") for (const bullet of bullets) consumed.add(bullet.line);
    }
    for (const i of visible)
      if (i >= start && i < end && !consumed.has(i) && lines[i]?.text.trim())
        other.push({ section: plain(section.title), title: plain(lines[i]?.text ?? "") });
  }
  return { outline, lines, visible, entries, other, summary };
}

export function parseInfo(
  outline: string,
  projects: string,
): Pick<InfoView, "summary" | "roles" | "projects" | "education" | "certifications" | "other"> {
  const scanned = scanOutline(outline);
  const items = parseProjects(projects).doc.items;
  return {
    summary: { text: scanned.outline.summary?.text ?? "" },
    roles: scanned.entries.filter((entry) => entry.collection === "roles").map((entry) => entry.value as Role),
    education: scanned.entries
      .filter((entry) => entry.collection === "education")
      .map((entry) => entry.value as Education),
    certifications: scanned.entries
      .filter((entry) => entry.collection === "certifications")
      .map((entry) => entry.value as Certification),
    projects: items
      .filter((item) => ["project", "role"].includes(item.meta.kind))
      .map(
        (item): Project => ({
          id: item.slug,
          name: item.name,
          ...(item.meta.period === undefined ? {} : { period: item.meta.period }),
          ...(typeof item.meta.purpose === "string" ? { purpose: item.meta.purpose } : {}),
          links: item.meta.links,
          stack: item.meta.stack,
          ...(item.meta.relationship ? { relationship: item.meta.relationship } : {}),
          ...(item.meta.contribution === undefined ? {} : { contribution: item.meta.contribution }),
          highlights: item.claims.map((claim) => ({ id: claim.id, text: claim.text })),
        }),
      ),
    other: scanned.other,
  };
}
async function optional(root: string, path: string) {
  try {
    return await readText(root, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export async function readInfo(root: string): Promise<InfoView> {
  const [outline, projects, profile] = await Promise.all([
    optional(root, "outline.md"),
    optional(root, "projects.md"),
    optional(root, "profile.yaml"),
  ]);
  const hash = (text: string | undefined) =>
    text === undefined ? "" : createHash("sha256").update(text).digest("hex");
  return {
    hash: { outline: hash(outline), projects: hash(projects), profile: hash(profile) },
    profile: Profile.parse(profile === undefined ? { name: "" } : parse(profile)),
    ...parseInfo(outline ?? "", projects ?? ""),
  };
}
function editLines(markdown: string, changes: Change[]) {
  let result = markdown;
  for (const change of changes.sort((a, b) => b.start - a.start || b.end - a.end))
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
  return result;
}
function offsets(lines: SourceLine[]) {
  const result = [0];
  for (const line of lines) result.push((result.at(-1) ?? 0) + line.text.length + line.ending.length);
  return result;
}
function changeField(lines: SourceLine[], field: Field, value: string): Change {
  const offset = offsets(lines)[field.line] ?? 0;
  return { start: offset + field.start, end: offset + field.end, text: value };
}
function newStatement(text: string, now: Date): Evidence {
  return { id: `ev-${randomUUID()}`, kind: "statement", text, at: localDate(now), ref: "info" };
}
function highlights(
  markdown: string,
  bullets: Entry["bullets"],
  requested: Highlight[],
  at: number,
  honesty: string,
  now: Date,
) {
  const lines = sourceLines(markdown);
  const positions = offsets(lines);
  const changes: Change[] = [];
  const retained = new Set<number>();
  const evidence: { id: string; evidence: Evidence[] }[] = [];
  const additions: string[] = [];
  const seen = new Set<string>();
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  for (const highlight of requested) {
    if (highlight.id && seen.has(highlight.id)) throw new InfoSourceError("invalid-source", "Duplicate highlight id");
    if (highlight.id) seen.add(highlight.id);
    const existing = bullets.find(
      (bullet) =>
        !retained.has(bullet.line) &&
        (highlight.id ? bullet.id === highlight.id : !bullet.id && bullet.text === highlight.text),
    );
    if (highlight.id && !existing)
      throw new InfoSourceError("invalid-source", "Highlight does not belong to this entry");
    if (existing) {
      retained.add(existing.line);
      if (existing.text !== highlight.text) {
        const line = lines[existing.line]?.text ?? "";
        const prefix = /^\s*[-*][ \t]+/.exec(line)?.[0] ?? "- ";
        const parsed = readAnchor(line);
        const suffix = parsed.anchor ? line.slice(parsed.text.length) : "";
        changes.push({
          start: positions[existing.line] ?? 0,
          end: (positions[existing.line] ?? 0) + line.length,
          text: prefix + highlight.text + suffix,
        });
      }
    } else {
      const id = `statement-${randomUUID()}`;
      const receipt = honesty === "strict" ? undefined : newStatement(highlight.text, now);
      additions.push(`- ${highlight.text} <!-- c:${id}${receipt ? ` ev:${receipt.id}` : ""} -->${eol}`);
      if (receipt) evidence.push({ id, evidence: [receipt] });
    }
  }
  for (const bullet of bullets)
    if (!retained.has(bullet.line))
      changes.push({
        start: positions[bullet.line] ?? 0,
        end: positions[bullet.line + 1] ?? markdown.length,
        text: "",
      });
  if (additions.length) {
    const position = positions[at] ?? markdown.length;
    changes.push({
      start: position,
      end: position,
      text: (position && !markdown.slice(0, position).endsWith("\n") ? eol : "") + additions.join(""),
    });
  }
  return { markdown: editLines(markdown, changes), evidence };
}

const schemas = {
  roles: { create: CreateInfoRoleRequest, update: PutInfoRoleRequest },
  projects: { create: CreateInfoProjectRequest, update: PutInfoProjectRequest },
  education: { create: CreateInfoEducationRequest, update: PutInfoEducationRequest },
  certifications: { create: CreateInfoCertificationRequest, update: PutInfoCertificationRequest },
};
export interface InfoEdit {
  collection: InfoCollection;
  action: "create" | "update" | "delete";
  id?: string;
  input: unknown;
}

function checkOutlineFields(entry: Entry, patch: Record<string, unknown>) {
  for (const [field, value] of Object.entries(patch)) {
    if (field !== "highlights" && ((entry.value as unknown as Record<string, unknown>)[field] ?? "") !== value)
      throw new InfoSourceError(
        "invalid-source",
        "This value cannot be represented in the entry's existing style. Edit it in the outline.",
      );
  }
}

function outlineEdit(
  markdown: string,
  collection: OutlineCollection,
  action: InfoEdit["action"],
  id: string | undefined,
  patch: Record<string, unknown>,
  honesty: string,
  now: Date,
): string {
  let scanned = scanOutline(markdown);
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  if (action === "create") {
    const sections = scanned.outline.sections.filter((section) => matches(section.title, sectionNames[collection]));
    const section =
      collection === "certifications" && !patch.status
        ? sections.find((section) => !matches(section.title, sectionNames.education))
        : sections[0];
    const styles = scanned.entries.filter(
      (entry) => entry.sectionLine === (section?.line ?? 0) - 1 && entry.collection === collection,
    );
    const dominant = [...styles].sort(
      (a, b) =>
        styles.filter((entry) => entry.heading === b.heading && entry.pipe === b.pipe).length -
        styles.filter((entry) => entry.heading === a.heading && entry.pipe === a.pipe).length,
    )[0];
    const title = String(patch.title ?? patch.degree ?? patch.name);
    const prefix = dominant?.heading === false ? `**${title}**` : `### ${title}`;
    let line = prefix;
    if (collection === "roles") {
      if (dominant?.pipe)
        line += `${patch.organisation ? ` | ${patch.organisation}` : ""} | *${patch.location ?? ""}* | *${patch.period ?? ""}*`;
      else if (patch.organisation)
        line =
          dominant?.heading === false ? `${prefix} — ${patch.organisation}` : `### ${patch.organisation} — ${title}`;
    } else if (collection === "education") line += `${patch.institution ? ` — ${patch.institution}` : ""}`;
    else if (patch.status) line += ` — ${patch.status}`;
    if (!dominant?.pipe && collection === "roles" && patch.period) line += `${eol}${patch.period}`;
    if (collection === "education" && patch.year) line += `${eol}${patch.year}`;
    if (collection === "education" && patch.details) line += `${eol}${patch.details}`;
    if (collection === "roles" && patch.location && !dominant?.pipe) line += `${eol}Location: ${patch.location}`;
    const next = section ? scanned.outline.sections.find((s) => s.line > section.line)?.line : undefined;
    const at = next ? (offsets(scanned.lines)[next - 1] ?? markdown.length) : markdown.length;
    const block = `${at && !markdown.slice(0, at).endsWith("\n") ? eol : ""}${section ? "" : `## ${sectionTitle[collection]}${eol}`}${line}${eol}${eol}`;
    const result = markdown.slice(0, at) + block + markdown.slice(at);
    const added = scanOutline(result).entries.find(
      (entry) => entry.start === sourceLines(markdown.slice(0, at)).length + (section ? 0 : 1),
    );
    if (
      !added ||
      added.collection !== collection ||
      scanned.entries.some((entry) => entry.collection === collection && entry.id === added.id)
    )
      throw new InfoSourceError("ambiguous", "An entry with this id already exists");
    checkOutlineFields(added, patch);
    if (collection === "roles" && Array.isArray(patch.highlights))
      return outlineHighlights(result, added, patch.highlights as Highlight[], honesty, now);
    return result;
  }
  const found = scanned.entries.filter((entry) => entry.collection === collection && entry.id === id);
  if (found.length !== 1)
    throw new InfoSourceError(found.length ? "ambiguous" : "not-found", "Entry not found or ambiguous");
  const entry = found[0] as Entry;
  const positions = offsets(scanned.lines);
  if (action === "delete") {
    const removed = new Set([
      entry.start,
      ...Object.values(entry.fields).map((field) => field.line),
      ...(collection === "roles" ? entry.bullets.map((bullet) => bullet.line) : []),
    ]);
    return editLines(
      markdown,
      [...removed].map((line) => ({
        start: positions[line] ?? 0,
        end: positions[line + 1] ?? markdown.length,
        text: "",
      })),
    );
  }
  const changes: Change[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "highlights") continue;
    if (entry.fields[key]) {
      if (value !== fieldText(scanned.lines, entry.fields[key]))
        changes.push(changeField(scanned.lines, entry.fields[key], String(value)));
    } else if (value) {
      if (key === "period" || key === "year" || key === "details" || key === "location") {
        const at = positions[entry.start + 1] ?? markdown.length;
        changes.push({ start: at, end: at, text: `${key === "location" ? "Location: " : ""}${value}${eol}` });
      } else {
        const at = (positions[entry.start] ?? 0) + (scanned.lines[entry.start]?.text.length ?? 0);
        // Pipe roles keep title | organisation | location | period; other entries use an em dash.
        const insertion = entry.pipe && key === "organisation" ? (entry.fields.title?.end ?? 0) : undefined;
        if (!entry.pipe && entry.heading && key === "organisation") {
          const title = entry.fields.title as Field;
          const position = (positions[entry.start] ?? 0) + title.start;
          changes.push({ start: position, end: position, text: `${value} — ` });
          continue;
        }
        changes.push({
          start: insertion === undefined ? at : (positions[entry.start] ?? 0) + insertion + (entry.heading ? 0 : 2),
          end: insertion === undefined ? at : (positions[entry.start] ?? 0) + insertion + (entry.heading ? 0 : 2),
          text: `${entry.pipe ? " | " : " — "}${value}`,
        });
      }
    }
  }
  let updated = editLines(markdown, changes);
  if (Array.isArray(patch.highlights)) {
    scanned = scanOutline(updated);
    const target = scanned.entries.find((candidate) => candidate.start === entry.start);
    if (!target) throw new InfoSourceError("invalid-source", "Edit would change the entry structure");
    updated = outlineHighlights(updated, target, patch.highlights as Highlight[], honesty, now);
  }
  const reparsed = scanOutline(updated);
  const changedEntry = reparsed.entries.find(
    (candidate) => candidate.start === entry.start && candidate.collection === collection,
  );
  if (!changedEntry) throw new InfoSourceError("invalid-source", "Edit would change the entry structure");
  checkOutlineFields(changedEntry, patch);
  if (
    reparsed.entries.filter((candidate) => candidate.collection === collection && candidate.id === changedEntry.id)
      .length > 1
  )
    throw new InfoSourceError("ambiguous", "An entry with this id already exists");
  return updated;
}
function outlineHighlights(markdown: string, entry: Entry, requested: Highlight[], honesty: string, now: Date) {
  const at = entry.bullets.at(-1)?.line !== undefined ? (entry.bullets.at(-1)?.line ?? 0) + 1 : entry.start + 1;
  const result = highlights(markdown, entry.bullets, requested, at, honesty, now);
  if (!result.evidence.length) return result.markdown;
  const updated = scanOutline(result.markdown).entries.find((candidate) => candidate.start === entry.start);
  const lines = sourceLines(result.markdown);
  const offset = offsets(lines)[updated?.end ?? lines.length] ?? result.markdown.length;
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const receipt = stringify({ statement_claims: result.evidence }, { lineWidth: 0 }).replace(/\n/g, eol);
  return `${result.markdown.slice(0, offset)}\`\`\`yaml${eol}${receipt}\`\`\`${eol}${result.markdown.slice(offset)}`;
}

function projectEdit(
  markdown: string,
  baseHash: string,
  action: InfoEdit["action"],
  id: string | undefined,
  patch: Record<string, unknown>,
  honesty: string,
  now: Date,
) {
  if (action === "create") {
    const slug = slugify(String(patch.name));
    if (parseProjects(markdown).doc.items.some((item) => item.slug === slug))
      throw new InfoSourceError("ambiguous", "A project with this id already exists");
    const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
    const { name, highlights: requested, ...meta } = patch;
    let result =
      markdown +
      `${markdown && !markdown.endsWith("\n") ? eol : ""}## ${name}${eol}\`\`\`yaml${eol}${stringify({ kind: "project", ...meta }, { lineWidth: 0 }).replace(/\n/g, eol)}\`\`\`${eol}### Claims${eol}`;
    result = projectHighlights(result, slug, (requested ?? []) as Highlight[], honesty, now);
    return result;
  }
  const parsed = parseProjects(markdown);
  const items = parsed.doc.items;
  const found = items.filter((item) => item.slug === id);
  if (found.length !== 1)
    throw new InfoSourceError(found.length ? "ambiguous" : "not-found", "Project not found or ambiguous");
  const item = found[0];
  if (!item || !["role", "project"].includes(item.meta.kind))
    throw new InfoSourceError("not-found", "Project not found");
  const next = items[items.indexOf(item) + 1]?.line;
  if (parsed.issues.some((issue) => issue.line >= item.line && (next === undefined || issue.line < next)))
    throw new InfoSourceError("invalid-source", "Project metadata is invalid");
  const lines = sourceLines(markdown);
  const positions = offsets(lines);
  const start = positions[item.line - 1] ?? 0;
  const end = next ? (positions[next - 1] ?? markdown.length) : markdown.length;
  if (action === "delete") return markdown.slice(0, start) + markdown.slice(end);
  let updated = markdown;
  const { name, highlights: requested, ...metadata } = patch;
  const changed = Object.fromEntries(
    Object.entries(metadata).filter(([key, value]) => JSON.stringify(item.meta[key]) !== JSON.stringify(value)),
  );
  if (Object.keys(changed).length)
    updated = projectMetadataProposal(updated, baseHash, item.slug, changed, "Update project", {
      blockStyle: true,
    }).after;
  if (Array.isArray(requested)) updated = projectHighlights(updated, item.slug, requested as Highlight[], honesty, now);
  if (name !== undefined && name !== item.name) {
    if (items.some((other) => other !== item && other.slug === slugify(String(name))))
      throw new InfoSourceError("ambiguous", "A project with this id already exists");
    const currentLines = sourceLines(updated);
    const heading = currentLines[item.line - 1]?.text ?? "";
    const prefix = /^##\s+/.exec(heading)?.[0] ?? "## ";
    updated = editLines(updated, [{ start, end: start + heading.length, text: prefix + name }]);
  }
  return updated;
}
function projectHighlights(markdown: string, slug: string, requested: Highlight[], honesty: string, now: Date) {
  const items = parseProjects(markdown).doc.items;
  const item = items.find((item) => item.slug === slug);
  if (!item) throw new InfoSourceError("not-found", "Project not found");
  const end = (items[items.indexOf(item) + 1]?.line ?? sourceLines(markdown).length + 1) - 1;
  const lines = sourceLines(markdown);
  const visible = outsideFences(lines);
  let inClaims = false;
  const bullets: Entry["bullets"] = [];
  let claimsHeading: number | undefined;
  for (let i = item.line; i < end; i++) {
    if (!visible.has(i)) continue;
    const text = lines[i]?.text ?? "";
    if (/^###\s/.test(text)) {
      inClaims = /^### Claims\s*$/.test(text);
      if (inClaims) claimsHeading = i;
    } else if (inClaims && bulletText(text) !== null) {
      const parsed = readAnchor(bulletText(text) ?? "");
      // parseProjects assigns deterministic ids to unanchored legacy bullets as well.
      const claim = item.claims[bullets.length];
      bullets.push({ line: i, text: parsed.text, id: claim?.id });
    }
  }
  if (claimsHeading === undefined && requested.length) {
    const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
    const at = offsets(lines)[end] ?? markdown.length;
    const addition = `${at && !markdown.slice(0, at).endsWith("\n") ? eol : ""}### Claims${eol}`;
    return projectHighlights(markdown.slice(0, at) + addition + markdown.slice(at), slug, requested, honesty, now);
  }
  const at = bullets.length ? (bullets.at(-1)?.line ?? 0) + 1 : (claimsHeading ?? end - 1) + 1;
  const result = highlights(markdown, bullets, requested, at, honesty, now);
  let updated = result.markdown;
  for (const receipt of result.evidence)
    for (const evidence of receipt.evidence) updated = appendEvidence(updated, slug, evidence);
  return updated;
}
function summaryEdit(markdown: string, text: string) {
  const scanned = scanOutline(markdown);
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const normalised = text.trim().replace(/\r\n|\r|\n/g, eol);
  if (!scanned.summary)
    return `${markdown}${markdown && !markdown.endsWith("\n") ? eol : ""}## Summary${eol}${normalised}${eol}`;
  const section = scanned.summary;
  const end = (scanned.outline.sections.find((s) => s.line > section.line)?.line ?? scanned.lines.length + 1) - 1;
  const content = [...scanned.visible].filter(
    (line) => line >= section.line && line < end && scanned.lines[line]?.text.trim(),
  );
  if (scanned.outline.summary?.text === normalised.replace(/\r\n/g, "\n")) return markdown;
  const positions = offsets(scanned.lines);
  const changes: Change[] = [];
  const first = content[0] ?? section.line;
  const anchors = content
    .flatMap((line) => {
      const raw = scanned.lines[line]?.text ?? "";
      return readAnchor(raw).anchor ? [raw.slice(readAnchor(raw).text.length)] : [];
    })
    .join(eol);
  for (const line of content)
    changes.push({ start: positions[line] ?? 0, end: positions[line + 1] ?? markdown.length, text: "" });
  const at = positions[first] ?? markdown.length;
  changes.push({ start: at, end: at, text: `${normalised}${anchors}${eol}` });
  return editLines(markdown, changes);
}

/** Callers serialize workspace mutations with the existing workspace-exclusive lock. */
export async function writeInfo(
  ws: WorkspaceHandle,
  edit: InfoEdit | { collection: "summary"; input: unknown },
  now = new Date(),
): Promise<{ view: InfoView; sha: string | null }> {
  const id = "id" in edit && edit.id !== undefined ? Slug.parse(edit.id) : undefined;
  const input =
    edit.collection === "summary"
      ? PutInfoSummaryRequest.parse(edit.input)
      : edit.action === "delete"
        ? DeleteInfoRequest.parse(edit.input)
        : schemas[edit.collection][edit.action].parse(edit.input);
  const { baseHash, ...patch } = input;
  const file = edit.collection === "projects" ? "projects" : "outline";
  const original = await optional(ws.root, `${file}.md`);
  const before = original ?? "";
  if ((original === undefined ? "" : createHash("sha256").update(before).digest("hex")) !== baseHash)
    throw new ChatConflictError("stale-hash", "Your information changed elsewhere. Reload and try again.");
  const { rules } = await loadRules(ws);
  const after =
    edit.collection === "summary"
      ? summaryEdit(before, String((patch as Record<string, unknown>).text))
      : edit.collection === "projects"
        ? projectEdit(before, baseHash, edit.action, id, patch, rules.honesty, now)
        : outlineEdit(before, edit.collection, edit.action, id, patch, rules.honesty, now);
  if (
    file === "projects" &&
    parseProjects(after).issues.some(
      (issue) => !parseProjects(before).issues.some((existing) => existing.message === issue.message),
    )
  )
    throw new InfoSourceError("invalid-source", "Edit would make project metadata invalid");
  const summary =
    edit.collection === "summary"
      ? "Update summary"
      : `${edit.action === "create" ? "Add" : edit.action === "delete" ? "Delete" : "Update"} ${edit.collection === "education" ? "education" : edit.collection.slice(0, -1)}`;
  const proposal: SourceProposal = { file, before, after, baseHash, summary };
  // Source proposals require nonempty search text. A missing or cleared file has no search span.
  let sha: string | null;
  if (before.trim()) ({ sha } = await applySourceEdit(ws, proposal, "user"));
  else {
    const release = await emptyEdits.acquire(resolveInWorkspace(ws.root, `${file}.md`), "writeInfo");
    try {
      if (((await fileHash(ws.root, `${file}.md`)) ?? "") !== baseHash)
        throw new ChatConflictError("stale-hash", "Your information changed elsewhere. Reload and try again.");
      await writeTextAtomic(ws.root, `${file}.md`, after);
      sha = await commitPaths(ws.root, [`${file}.md`], summary, "user");
    } finally {
      release();
    }
  }
  return { view: await readInfo(ws.root), sha };
}
