import type { Relationship } from "@vita/shared";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useOwnership, useSetRelationship } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { githubRepo } from "@/lib/projects-view";

export const roleLabels = {
  sole: "Sole developer",
  lead: "Lead",
  team: "Team member",
  contributor: "Contributor",
} as const satisfies Record<Relationship, string>;
const choices = (Object.keys(roleLabels) as Relationship[]).map((value) => ({ value, label: roleLabels[value] }));

/** Asks what role the user played in a project. The GitHub suggestion is shown, never saved on its own. */
export function ProjectRole({
  slug,
  repoUrl,
  value,
  contribution,
}: {
  slug: string;
  repoUrl?: string;
  value?: Relationship;
  contribution?: string;
}) {
  const textId = useId();
  const ownership = useOwnership(repoUrl ? githubRepo(repoUrl) : undefined);
  const save = useSetRelationship();
  const [role, setRole] = useState<Relationship | undefined>(value);
  const [text, setText] = useState(contribution ?? "");
  const needsText = role === "team" || role === "contributor";
  const suggestion = ownership.data;
  const suggested = suggestion && suggestion.suggestion !== "unknown" ? roleLabels[suggestion.suggestion] : undefined;
  const submit = () => {
    if (!role) return;
    save.mutate(
      { slug, body: { relationship: role, ...(needsText ? { contribution: text.trim() } : {}) } },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save."),
      },
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Your role</legend>
        <div className="flex flex-wrap gap-2">
          {choices.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant={role === choice.value ? "default" : "outline"}
              aria-pressed={role === choice.value}
              className="h-11"
              onClick={() => setRole(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </div>
        {suggested && (
          <p className="text-sm text-muted-foreground">
            Suggested: {suggested}. {suggestion?.reason}
          </p>
        )}
      </fieldset>
      {needsText && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={textId}>What did you build or own?</Label>
          <Textarea id={textId} value={text} onChange={(event) => setText(event.target.value)} className="min-h-20" />
        </div>
      )}
      <Button type="button" className="h-11 w-fit" onClick={submit} disabled={!role || save.isPending}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
