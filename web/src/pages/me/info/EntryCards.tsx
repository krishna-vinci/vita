import type { Certification, Education, Project, Role } from "@vita/shared";
import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { githubRepo } from "@/lib/projects-view";
import { ProjectRole } from "../ProjectRole";
import { EntryCard, SaveBar } from "./EntryCard";
import { DatesField, HighlightsEditor, LinksEditor, TagsInput, TextField } from "./fields";
import { useCardDraft, useCardSave, useInfoContext } from "./info-context";
import {
  fieldId,
  type HighlightRow,
  hasEmptyHighlight,
  highlightsFrom,
  isWebLink,
  type LinkRow,
  linkLabel,
  linkRowsFrom,
  linksFrom,
  rowsFrom,
} from "./info-model";

/** Shared props for the cards of the list sections. `entry` is missing while a new one is being added. */
interface CardProps<T> {
  entry?: T;
  open: boolean;
  onToggle: () => void;
  focusField?: { id: string; token: number } | null;
  /** Called after a new entry was created, so the page closes the "add" card. */
  onCreated?: () => void;
  /** Called with the card key the entry now has (a new name can change its id). */
  onMoved?: (card: string) => void;
}

/** The fields whose trimmed value changed, as a patch. Empty text is kept: it clears an optional field. */
function changed<T extends Record<string, unknown>>(now: T, before: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(now) as (keyof T)[])
    if (JSON.stringify(now[key]) !== JSON.stringify(before[key])) patch[key] = now[key];
  return patch;
}
const present = <T extends Record<string, unknown>>(body: T): Partial<T> => {
  const result: Partial<T> = {};
  for (const key of Object.keys(body) as (keyof T)[]) if (body[key] !== "") result[key] = body[key];
  return result;
};

// ---------------------------------------------------------------- Roles

interface RoleDraft {
  title: string;
  organisation: string;
  location: string;
  period: string;
  highlights: HighlightRow[];
}
const roleDraft = (role?: Role): RoleDraft => ({
  title: role?.title ?? "",
  organisation: role?.organisation ?? "",
  location: role?.location ?? "",
  period: role?.period ?? "",
  highlights: rowsFrom(role?.highlights ?? []),
});
const roleBody = (d: RoleDraft) => ({
  title: d.title.trim(),
  organisation: d.organisation.trim(),
  location: d.location.trim(),
  period: d.period.trim(),
  highlights: highlightsFrom(d.highlights),
});

export function RoleCard({ entry, open, onToggle, focusField, onCreated }: CardProps<Role>) {
  const { view, mutate } = useInfoContext();
  const card = `role:${entry?.id ?? "new"}`;
  const initial = useMemo(() => roleDraft(entry), [entry]);
  const form = useCardDraft(card, initial, roleBody, card);
  const { saving, error, run, clearError } = useCardSave();
  const body = roleBody(form.draft);
  const canSave = body.title !== "" && !hasEmptyHighlight(form.draft.highlights);
  const baseHash = view.hash.outline;
  const cancel = () => {
    form.reset();
    clearError();
  };
  const save = async () => {
    const result = await run(() =>
      entry
        ? api.info.roles.update(entry.id, { ...changed(body, roleBody(initial)), baseHash })
        : api.info.roles.create({ ...present(body), title: body.title, highlights: body.highlights, baseHash }),
    );
    if (!result) return;
    form.reset();
    if (!entry) onCreated?.();
  };
  const id = (field: string) => fieldId(card, field);
  return (
    <EntryCard
      card={card}
      title={entry ? entry.title : "New role"}
      summary={entry ? [entry.organisation, entry.location, entry.period].filter(Boolean).join(" · ") : undefined}
      open={open}
      onToggle={onToggle}
      dirty={form.dirty && !!entry}
      restored={form.restored}
      onDiscardRestored={form.reset}
      focusField={focusField}
      deleteName={entry ? entry.title : undefined}
      onDelete={entry ? () => mutate(() => api.info.roles.remove(entry.id, { baseHash })) : undefined}
    >
      <TextField id={id("title")} label="Title" value={form.draft.title} onChange={(title) => form.set({ title })} />
      <TextField
        id={id("organisation")}
        label="Organisation"
        value={form.draft.organisation}
        onChange={(organisation) => form.set({ organisation })}
      />
      <TextField
        id={id("location")}
        label="Location"
        value={form.draft.location}
        onChange={(location) => form.set({ location })}
        placeholder="Remote"
      />
      <DatesField id={id("period")} value={form.draft.period} onChange={(period) => form.set({ period })} />
      <HighlightsEditor
        idPrefix={fieldId(card, "list")}
        rows={form.draft.highlights}
        onChange={(highlights) => form.set({ highlights })}
      />
      <SaveBar
        dirty={form.dirty}
        saving={saving}
        canSave={canSave}
        error={error}
        onSave={() => void save()}
        onCancel={cancel}
      />
    </EntryCard>
  );
}

// ---------------------------------------------------------------- Projects

interface ProjectDraft {
  name: string;
  purpose: string;
  period: string;
  links: LinkRow[];
  stack: string[];
  highlights: HighlightRow[];
}
const projectDraft = (project?: Project): ProjectDraft => ({
  name: project?.name ?? "",
  purpose: project?.purpose ?? "",
  period: project?.period ?? "",
  links: linkRowsFrom(project?.links ?? []),
  stack: project?.stack ?? [],
  highlights: rowsFrom(project?.highlights ?? []),
});
const projectBody = (d: ProjectDraft) => ({
  name: d.name.trim(),
  purpose: d.purpose.trim(),
  period: d.period.trim(),
  links: linksFrom(d.links),
  stack: d.stack,
  highlights: highlightsFrom(d.highlights),
});

export function ProjectCard({ entry, open, onToggle, focusField, onCreated, onMoved }: CardProps<Project>) {
  const { view, mutate } = useInfoContext();
  const card = `project:${entry?.id ?? "new"}`;
  const initial = useMemo(() => projectDraft(entry), [entry]);
  const form = useCardDraft(card, initial, projectBody, card);
  const { saving, error, run, clearError } = useCardSave();
  const body = projectBody(form.draft);
  const badLink = body.links.find((link) => !isWebLink(link));
  const canSave = body.name !== "" && !badLink && !hasEmptyHighlight(form.draft.highlights);
  const baseHash = view.hash.projects;
  const cancel = () => {
    form.reset();
    clearError();
  };
  const save = async () => {
    const result = await run(() =>
      entry
        ? api.info.projects.update(entry.id, { ...changed(body, projectBody(initial)), baseHash })
        : api.info.projects.create({
            ...present(body),
            name: body.name,
            links: body.links,
            stack: body.stack,
            highlights: body.highlights,
            baseHash,
          }),
    );
    if (!result) return;
    form.reset();
    if (!entry) onCreated?.();
    else {
      // A new name can give the project a new id; keep the same card open.
      const now = result.projects.find((project) => project.name === body.name);
      if (now && now.id !== entry.id) onMoved?.(`project:${now.id}`);
    }
  };
  const id = (field: string) => fieldId(card, field);
  const repo = entry?.links.find((link) => githubRepo(link));
  return (
    <EntryCard
      card={card}
      title={entry ? entry.name : "New project"}
      summary={entry ? [entry.period, entry.purpose].filter(Boolean).join(" · ") : undefined}
      chips={entry?.links.map((link) => (
        <Badge key={link} variant="outline" asChild>
          <a href={link} target="_blank" rel="noreferrer" aria-label={`Open ${linkLabel(link)}`}>
            <ExternalLink /> {linkLabel(link)}
          </a>
        </Badge>
      ))}
      open={open}
      onToggle={onToggle}
      dirty={form.dirty && !!entry}
      restored={form.restored}
      onDiscardRestored={form.reset}
      focusField={focusField}
      deleteName={entry ? entry.name : undefined}
      onDelete={entry ? () => mutate(() => api.info.projects.remove(entry.id, { baseHash })) : undefined}
    >
      <TextField id={id("name")} label="Name" value={form.draft.name} onChange={(name) => form.set({ name })} />
      <TextField
        id={id("purpose")}
        label="Purpose"
        hint="One line: what it is and who it's for"
        placeholder="A self-hosted news reader that filters feeds with AI for busy readers"
        value={form.draft.purpose}
        onChange={(purpose) => form.set({ purpose })}
      />
      <DatesField id={id("period")} value={form.draft.period} onChange={(period) => form.set({ period })} />
      <LinksEditor idPrefix={fieldId(card, "list")} rows={form.draft.links} onChange={(links) => form.set({ links })} />
      {badLink && (
        <p role="alert" className="-mt-3 text-sm text-destructive">
          "{linkLabel(badLink)}" does not look like a web link.
        </p>
      )}
      <TagsInput
        id={id("stack")}
        label="Stack"
        values={form.draft.stack}
        onChange={(stack) => form.set({ stack })}
        placeholder="Type a tool and press Enter: Python, FastAPI…"
      />
      {entry ? (
        <div className="flex flex-col gap-2">
          <ProjectRole
            key={`${entry.relationship ?? "none"}:${entry.contribution ?? ""}`}
            slug={entry.id}
            repoUrl={repo}
            value={entry.relationship}
            contribution={entry.contribution}
            saveLabel="Save role"
          />
          <p className="text-sm text-muted-foreground">Your role saves on its own.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Add the project first, then set your role in it.</p>
      )}
      <HighlightsEditor
        idPrefix={fieldId(card, "list")}
        rows={form.draft.highlights}
        onChange={(highlights) => form.set({ highlights })}
      />
      <SaveBar
        dirty={form.dirty}
        saving={saving}
        canSave={canSave}
        error={error}
        onSave={() => void save()}
        onCancel={cancel}
      />
    </EntryCard>
  );
}

// ---------------------------------------------------------------- Education

interface EducationDraft {
  degree: string;
  institution: string;
  year: string;
}
const educationDraft = (entry?: Education): EducationDraft => ({
  degree: entry?.degree ?? "",
  institution: entry?.institution ?? "",
  year: entry?.year ?? "",
});
const educationBody = (d: EducationDraft) => ({
  degree: d.degree.trim(),
  institution: d.institution.trim(),
  year: d.year.trim(),
});

export function EducationCard({ entry, open, onToggle, focusField, onCreated }: CardProps<Education>) {
  const { view, mutate } = useInfoContext();
  const card = `education:${entry?.id ?? "new"}`;
  const initial = useMemo(() => educationDraft(entry), [entry]);
  const form = useCardDraft(card, initial, educationBody, card);
  const { saving, error, run, clearError } = useCardSave();
  const body = educationBody(form.draft);
  const baseHash = view.hash.outline;
  const save = async () => {
    const result = await run(() =>
      entry
        ? api.info.education.update(entry.id, { ...changed(body, educationBody(initial)), baseHash })
        : api.info.education.create({ ...present(body), degree: body.degree, baseHash }),
    );
    if (!result) return;
    form.reset();
    if (!entry) onCreated?.();
  };
  const id = (field: string) => fieldId(card, field);
  return (
    <EntryCard
      card={card}
      title={entry ? entry.degree : "New education"}
      summary={entry ? [entry.institution, entry.year].filter(Boolean).join(" · ") : undefined}
      open={open}
      onToggle={onToggle}
      dirty={form.dirty && !!entry}
      restored={form.restored}
      onDiscardRestored={form.reset}
      focusField={focusField}
      deleteName={entry ? entry.degree : undefined}
      onDelete={entry ? () => mutate(() => api.info.education.remove(entry.id, { baseHash })) : undefined}
    >
      <TextField
        id={id("degree")}
        label="Degree"
        value={form.draft.degree}
        onChange={(degree) => form.set({ degree })}
        placeholder="BSc in Computing"
      />
      <TextField
        id={id("institution")}
        label="Institution"
        value={form.draft.institution}
        onChange={(institution) => form.set({ institution })}
      />
      <TextField
        id={id("year")}
        label="Year"
        hint="The year you finished, or expect to"
        value={form.draft.year}
        onChange={(year) => form.set({ year })}
        placeholder="2023"
      />
      <SaveBar
        dirty={form.dirty}
        saving={saving}
        canSave={body.degree !== ""}
        error={error}
        onSave={() => void save()}
        onCancel={() => {
          form.reset();
          clearError();
        }}
      />
    </EntryCard>
  );
}

// ---------------------------------------------------------------- Certifications

interface CertificationDraft {
  name: string;
  status: string;
}
const certificationDraft = (entry?: Certification): CertificationDraft => ({
  name: entry?.name ?? "",
  status: entry?.status ?? "",
});
const certificationBody = (d: CertificationDraft) => ({ name: d.name.trim(), status: d.status.trim() });

export function CertificationCard({ entry, open, onToggle, focusField, onCreated }: CardProps<Certification>) {
  const { view, mutate } = useInfoContext();
  const card = `certification:${entry?.id ?? "new"}`;
  const initial = useMemo(() => certificationDraft(entry), [entry]);
  const form = useCardDraft(card, initial, certificationBody, card);
  const { saving, error, run, clearError } = useCardSave();
  const body = certificationBody(form.draft);
  const baseHash = view.hash.outline;
  const save = async () => {
    const result = await run(() =>
      entry
        ? api.info.certifications.update(entry.id, { ...changed(body, certificationBody(initial)), baseHash })
        : api.info.certifications.create({ ...present(body), name: body.name, baseHash }),
    );
    if (!result) return;
    form.reset();
    if (!entry) onCreated?.();
  };
  const id = (field: string) => fieldId(card, field);
  return (
    <EntryCard
      card={card}
      title={entry ? entry.name : "New certification"}
      summary={entry?.status}
      open={open}
      onToggle={onToggle}
      dirty={form.dirty && !!entry}
      restored={form.restored}
      onDiscardRestored={form.reset}
      focusField={focusField}
      deleteName={entry ? entry.name : undefined}
      onDelete={entry ? () => mutate(() => api.info.certifications.remove(entry.id, { baseHash })) : undefined}
    >
      <TextField
        id={id("name")}
        label="Name"
        value={form.draft.name}
        onChange={(name) => form.set({ name })}
        placeholder="AWS Certified Solutions Architect"
      />
      <TextField
        id={id("status")}
        label="Year or status"
        value={form.draft.status}
        onChange={(status) => form.set({ status })}
        placeholder="2025, or In progress"
      />
      <SaveBar
        dirty={form.dirty}
        saving={saving}
        canSave={body.name !== ""}
        error={error}
        onSave={() => void save()}
        onCancel={() => {
          form.reset();
          clearError();
        }}
      />
    </EntryCard>
  );
}
