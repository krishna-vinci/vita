import type { Relationship } from "@vita/shared";
import { toast } from "sonner";
import { useSetRelationship } from "@/api/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const ownershipPrefix = "ownership.";
export const isOwnership = (id: string) => id.startsWith(ownershipPrefix);
export const projectSlug = (id: string) => id.slice(ownershipPrefix.length);

export interface OwnershipValue {
  role?: Relationship;
  text: string;
  remember: boolean;
}
export const emptyOwnership: OwnershipValue = { text: "", remember: true };

const roles: { value: Relationship; label: string }[] = [
  { value: "sole", label: "Sole developer" },
  { value: "lead", label: "Lead" },
  { value: "team", label: "Team member" },
  { value: "contributor", label: "Contributor" },
];
const asksWhat = (role?: Relationship) => role === "team" || role === "contributor";

/** The string the backend parses: `sole`, or `team: built the importer`. */
export function ownershipAnswer(value: OwnershipValue): string | undefined {
  if (!value.role) return undefined;
  const text = asksWhat(value.role) ? value.text.trim() : "";
  return text ? `${value.role}: ${text}` : value.role;
}

/** One card per project whose role in it is unknown. Nothing is assumed until a choice is made. */
export function OwnershipQuestion({
  id,
  question,
  value,
  onChange,
}: {
  id: string;
  question: string;
  value: OwnershipValue;
  onChange: (next: OwnershipValue) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle id={`q-${id}`} className="font-display text-lg font-medium">
          {question}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-labelledby={`q-${id}`}>
          {roles.map((role) => (
            <label
              key={role.value}
              className={cn(
                "flex h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm font-medium transition-colors hover:bg-accent",
                "has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              )}
            >
              <input
                type="radio"
                name={`role-${id}`}
                value={role.value}
                checked={value.role === role.value}
                onChange={() => onChange({ ...value, role: role.value })}
                className="sr-only"
              />
              {role.label}
            </label>
          ))}
        </fieldset>
        {asksWhat(value.role) && (
          <div className="flex flex-col gap-2">
            <Label htmlFor={`o-${id}`}>What did you build or own?</Label>
            <Textarea
              id={`o-${id}`}
              value={value.text}
              onChange={(event) => onChange({ ...value, text: event.target.value })}
              placeholder="e.g. The import pipeline and the admin screens"
              className="min-h-20"
            />
          </div>
        )}
        {value.role && (
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={`r-${id}`}
              checked={value.remember}
              onCheckedChange={(checked) => onChange({ ...value, remember: checked === true })}
            />
            <Label htmlFor={`r-${id}`} className="cursor-pointer">
              Remember for this project
            </Label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export interface Remembered {
  slug: string;
  relationship: Relationship;
  contribution?: string;
}

/** Saves the checked roles on their projects. A failure is shown but never stops the answers going out. */
export function useRememberOwnership() {
  const save = useSetRelationship();
  return async (items: Remembered[]) => {
    for (const item of items) {
      try {
        await save.mutateAsync({
          slug: item.slug,
          relationship: item.relationship,
          ...(item.contribution ? { contribution: item.contribution } : {}),
        });
      } catch (error) {
        toast.error(
          `Couldn't remember your role for ${item.slug}. Your answer is still used for this resume.${
            error instanceof Error && error.message ? ` (${error.message})` : ""
          }`,
        );
      }
    }
  };
}
