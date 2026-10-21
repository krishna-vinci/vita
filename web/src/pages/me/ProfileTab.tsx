import { useQueryClient } from "@tanstack/react-query";
import type { Contact, Profile, ProfileView, Relationship } from "@vita/shared";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { queryKeys, useProfile, useSaveProfile } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** The server accepts at most this many contact rows. */
const maxContacts = 12;

const relationshipChoices: { value: Relationship | "unset"; label: string }[] = [
  { value: "unset", label: "Not set: ask me per project" },
  { value: "sole", label: "Mine: I built them alone" },
  { value: "lead", label: "Led by me" },
  { value: "team", label: "Team work" },
  { value: "contributor", label: "Contributions to others' projects" },
];

type Row = Contact & { id: number };
interface Draft {
  name: string;
  headline: string;
  location: string;
  relationship: Relationship | "unset";
  rows: Row[];
}

let lastRowId = 0;
const withId = (contact: Contact): Row => ({ ...contact, id: ++lastRowId });

function draftFrom(profile: Profile | null): Draft {
  return {
    name: profile?.name ?? "",
    headline: profile?.headline ?? "",
    location: profile?.location ?? "",
    relationship: profile?.default_relationship ?? "unset",
    rows: (profile?.contact ?? []).map(withId),
  };
}

/** The body Vita saves: trimmed, blank contact rows dropped, unset optional fields left out. */
function profileFrom(draft: Draft): Profile {
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

export default function ProfileTab() {
  const query = useProfile();
  const save = useSaveProfile();
  const client = useQueryClient();
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  const submit = (profile: Profile) =>
    save.mutate(
      { profile, baseHash: query.data.hash },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            toast.error("Your profile changed elsewhere. Reloaded.");
            void client.invalidateQueries({ queryKey: queryKeys.profile });
          } else if (!(error instanceof ApiError && error.status === 400)) {
            toast.error(error instanceof Error ? error.message : "Could not save your profile.");
          }
        },
      },
    );
  // Keyed by the saved version, so a new server copy starts the form afresh.
  return (
    <ProfileForm key={query.data.hash} view={query.data} saving={save.isPending} error={save.error} onSubmit={submit} />
  );
}

function ProfileForm({
  view,
  saving,
  error,
  onSubmit,
}: {
  view: ProfileView;
  saving: boolean;
  error: Error | null;
  onSubmit: (profile: Profile) => void;
}) {
  const ids = useId();
  const [draft, setDraft] = useState(() => draftFrom(view.profile));
  const body = profileFrom(draft);
  const dirty = JSON.stringify(body) !== JSON.stringify(profileFrom(draftFrom(view.profile)));
  const canSave = dirty && body.name !== "" && !saving;
  const serverMessage = error instanceof ApiError && error.status === 400 ? error.message : null;
  const updateRow = (id: number, patch: Partial<Contact>) =>
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Your details</CardTitle>
        <CardDescription>These go at the top of every resume and cover letter.</CardDescription>
      </CardHeader>
      <CardContent>
        {!view.profile && <p className="mb-6 text-muted-foreground">Add your name to begin.</p>}
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) onSubmit(body);
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-name`}>Name</Label>
            <Input
              id={`${ids}-name`}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              required
              autoComplete="name"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-headline`}>Headline</Label>
            <Input
              id={`${ids}-headline`}
              value={draft.headline}
              onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
              placeholder="Product, backend and platform developer"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-location`}>Location</Label>
            <Input
              id={`${ids}-location`}
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              placeholder="Remote, India"
              autoComplete="off"
            />
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Contacts</legend>
            {draft.rows.map((row, index) => (
              <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  aria-label={`Contact ${index + 1} label`}
                  className="sm:w-40"
                  value={row.label}
                  onChange={(event) => updateRow(row.id, { label: event.target.value })}
                  placeholder="GitHub"
                  autoComplete="off"
                />
                <Input
                  aria-label={`Contact ${index + 1} value`}
                  className="sm:flex-1"
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                  placeholder="github.com/you"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 self-end sm:self-auto"
                  aria-label={`Remove ${row.label.trim() || "contact"}`}
                  onClick={() => setDraft({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}
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
                onClick={() => setDraft({ ...draft, rows: [...draft.rows, { id: ++lastRowId, label: "", value: "" }] })}
              >
                <Plus /> Add contact
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Links without https:// are fine. Vita shows them short and clickable, e.g. github.com/you → you.
            </p>
          </fieldset>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${ids}-relationship`}>My projects are</Label>
            <Select
              value={draft.relationship}
              onValueChange={(value) => setDraft({ ...draft, relationship: value as Relationship | "unset" })}
            >
              <SelectTrigger id={`${ids}-relationship`} className="w-full">
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
              Used for every project without its own role. You can still set a role per project in Projects.
            </p>
          </div>

          {serverMessage && (
            <p role="alert" className="text-sm text-destructive">
              {serverMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" className="h-11" disabled={!canSave}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={!dirty || saving}
              onClick={() => setDraft(draftFrom(view.profile))}
            >
              Discard changes
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
