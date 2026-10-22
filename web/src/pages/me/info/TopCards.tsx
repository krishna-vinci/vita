import type { Contact, Profile, Relationship } from "@vita/shared";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { api } from "@/api/client";
import { RestoredNote } from "@/components/LeaveGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SaveBar } from "./EntryCard";
import { Field, TextField } from "./fields";
import { useCardDraft, useCardSave, useInfoContext } from "./info-context";
import { newKey } from "./info-model";

/** The server accepts at most this many contact rows. */
const maxContacts = 12;

const relationshipChoices: { value: Relationship | "unset"; label: string }[] = [
  { value: "unset", label: "Not set: ask me per project" },
  { value: "sole", label: "Mine: I built them alone" },
  { value: "lead", label: "Led by me" },
  { value: "team", label: "Team work" },
  { value: "contributor", label: "Contributions to others' projects" },
];

type Row = Contact & { k: string };
interface AboutDraft {
  name: string;
  headline: string;
  location: string;
  relationship: Relationship | "unset";
  rows: Row[];
}
const aboutDraft = (profile: Profile): AboutDraft => ({
  name: profile.name ?? "",
  headline: profile.headline ?? "",
  location: profile.location ?? "",
  relationship: profile.default_relationship ?? "unset",
  rows: (profile.contact ?? []).map((contact) => ({ ...contact, k: newKey() })),
});
/** The body Vita saves: trimmed, blank contact rows dropped, unset optional fields left out. */
function profileFrom(draft: AboutDraft): Profile {
  return {
    name: draft.name.trim(),
    headline: draft.headline.trim() || undefined,
    location: draft.location.trim() || undefined,
    contact: draft.rows
      .filter((row) => row.label.trim() || row.value.trim())
      .map((row) => ({
        label: row.label.trim(),
        value: row.value.trim(),
        ...(row.url ? { url: row.url } : {}),
      })),
    default_relationship: draft.relationship === "unset" ? undefined : draft.relationship,
  };
}

export function AboutCard() {
  const { view } = useInfoContext();
  const initial = useMemo(() => aboutDraft(view.profile), [view.profile]);
  const form = useCardDraft("profile", initial, profileFrom, "profile");
  const { saving, error, run, clearError } = useCardSave();
  const { draft } = form;
  const body = profileFrom(draft);
  const updateRow = (k: string, patch: Partial<Contact>) =>
    form.set({ rows: draft.rows.map((row) => (row.k === k ? { ...row, ...patch } : row)) });
  const save = async () => {
    const result = await run(() => api.info.saveProfile({ profile: body, baseHash: view.hash.profile }));
    if (result) form.reset();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">About you</CardTitle>
        <CardDescription>These go at the top of every resume and cover letter.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {form.restored && <RestoredNote onDiscard={form.reset} />}
        <TextField id="info-name" label="Name" value={draft.name} onChange={(name) => form.set({ name })} required />
        <TextField
          id="info-headline"
          label="Headline"
          value={draft.headline}
          onChange={(headline) => form.set({ headline })}
          placeholder="Product, backend and platform developer"
        />
        <TextField
          id="info-location"
          label="Location"
          value={draft.location}
          onChange={(location) => form.set({ location })}
          placeholder="Remote, India"
        />
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Contacts</legend>
          {draft.rows.map((row, index) => (
            <div key={row.k} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                aria-label={`Contact ${index + 1} label`}
                className="sm:w-40"
                value={row.label}
                onChange={(event) => updateRow(row.k, { label: event.target.value })}
                placeholder="GitHub"
                autoComplete="off"
              />
              <Input
                aria-label={`Contact ${index + 1} value`}
                className="sm:flex-1"
                value={row.value}
                onChange={(event) => updateRow(row.k, { value: event.target.value })}
                placeholder="github.com/you"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 self-end sm:self-auto"
                aria-label={`Remove ${row.label.trim() || "contact"}`}
                onClick={() => form.set({ rows: draft.rows.filter((item) => item.k !== row.k) })}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={draft.rows.length >= maxContacts}
              onClick={() => form.set({ rows: [...draft.rows, { k: newKey(), label: "", value: "" }] })}
            >
              <Plus /> Add contact
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Links without https:// are fine. Vita shows them short and clickable, e.g. github.com/you → you.
          </p>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Label htmlFor="info-relationship">My projects are</Label>
          <Select
            value={draft.relationship}
            onValueChange={(value) => form.set({ relationship: value as Relationship | "unset" })}
          >
            <SelectTrigger id="info-relationship" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {relationshipChoices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Used for every project without its own role. You can still set a role on each project below.
          </p>
        </div>
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
      </CardContent>
    </Card>
  );
}

export function SummaryCard() {
  const { view } = useInfoContext();
  const initial = useMemo(() => ({ text: view.summary.text }), [view.summary.text]);
  const form = useCardDraft("summary", initial, (draft) => draft.text.trim(), "summary");
  const { saving, error, run, clearError } = useCardSave();
  const save = async () => {
    const result = await run(() => api.info.saveSummary({ text: form.draft.text.trim(), baseHash: view.hash.outline }));
    if (result) form.reset();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg">Summary</CardTitle>
        <CardDescription>The short introduction at the top of your resumes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {form.restored && <RestoredNote onDiscard={form.reset} />}
        <Field
          id="info-summary"
          label="Summary"
          hint="2–3 sentences: what you do, your strongest skills, what you want next."
        >
          <Textarea
            id="info-summary"
            className="min-h-28"
            value={form.draft.text}
            onChange={(event) => form.set({ text: event.target.value })}
          />
        </Field>
        <SaveBar
          dirty={form.dirty}
          saving={saving}
          canSave
          error={error}
          onSave={() => void save()}
          onCancel={() => {
            form.reset();
            clearError();
          }}
        />
      </CardContent>
    </Card>
  );
}
