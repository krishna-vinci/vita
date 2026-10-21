import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useJsonDraft } from "@/lib/use-draft";
import { cn } from "@/lib/utils";
import {
  emptyOwnership,
  isOwnership,
  OwnershipQuestion,
  type OwnershipValue,
  ownershipAnswer,
  projectSlug,
  type Remembered,
} from "./OwnershipQuestion";

export interface Gap {
  id: string;
  question: string;
}
export function parseGaps(gaps: string[]): Gap[] {
  return gaps.map((gap) => {
    const at = gap.indexOf(":");
    return at < 0 ? { id: gap, question: gap } : { id: gap.slice(0, at).trim(), question: gap.slice(at + 1).trim() };
  });
}

type Choice = "yes" | "no" | "skip";
interface Saved {
  choices?: Record<string, Choice>;
  details?: Record<string, string>;
  owners?: Record<string, OwnershipValue>;
}

/** One card per thing the job asks for that the user's notes do not yet show. */
export function Questions({
  gaps,
  pending,
  onSubmit,
  onSkipAll,
  onRemember,
  heading,
  intro,
  submitLabel = "Continue",
  skipLabel = "Skip and show my resume",
  stickyActions = false,
  notice,
  draftKey,
}: {
  gaps: Gap[];
  pending: boolean;
  /** Return `false` when the answers could not be sent, so the typed text is kept. */
  onSubmit: (answers: Record<string, string>) => unknown;
  onSkipAll: () => void;
  /** Called with the ownership answers marked "Remember", before `onSubmit`. */
  onRemember?: (items: Remembered[]) => Promise<void>;
  heading?: ReactNode;
  intro?: ReactNode;
  submitLabel?: string;
  skipLabel?: string;
  /** Keep the buttons in view on a phone. */
  stickyActions?: boolean;
  notice?: ReactNode;
  /** Keeps the choices and typed details for this tab, e.g. `questions:j1`. Cleared once sent. */
  draftKey: string;
}) {
  const [saved, setSaved, clearSaved] = useJsonDraft<Saved>(draftKey, {});
  const choices = saved.choices ?? {};
  const details = saved.details ?? {};
  const owners = saved.owners ?? {};
  const setChoices = (next: (all: Record<string, Choice>) => Record<string, Choice>) =>
    setSaved((all) => ({ ...all, choices: next(all.choices ?? {}) }));
  const setDetails = (next: (all: Record<string, string>) => Record<string, string>) =>
    setSaved((all) => ({ ...all, details: next(all.details ?? {}) }));
  const setOwners = (next: (all: Record<string, OwnershipValue>) => Record<string, OwnershipValue>) =>
    setSaved((all) => ({ ...all, owners: next(all.owners ?? {}) }));
  const [saving, setSaving] = useState(false);
  const collect = () => {
    const answers: Record<string, string> = {};
    const remember: Remembered[] = [];
    for (const gap of gaps) {
      if (isOwnership(gap.id)) {
        const value = owners[gap.id] ?? emptyOwnership;
        const answer = ownershipAnswer(value);
        if (!answer || !value.role) continue;
        answers[gap.id] = answer;
        const contribution = answer.includes(":") ? answer.slice(answer.indexOf(":") + 1).trim() : undefined;
        if (value.remember) remember.push({ slug: projectSlug(gap.id), relationship: value.role, contribution });
        continue;
      }
      if (choices[gap.id] === "yes")
        answers[gap.id] = details[gap.id]?.trim() ? `Yes: ${details[gap.id]?.trim()}` : "yes";
      if (choices[gap.id] === "no") answers[gap.id] = "no";
    }
    return { answers, remember };
  };
  const answered = Object.keys(collect().answers).length;
  const submit = async () => {
    const { answers, remember } = collect();
    if (remember.length && onRemember) {
      setSaving(true);
      try {
        await onRemember(remember);
      } finally {
        setSaving(false);
      }
    }
    if ((await onSubmit(answers)) !== false) clearSaved();
  };
  const busy = pending || saving;
  return (
    <section aria-labelledby="questions-title" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="questions-title" className="font-display text-2xl font-bold">
          {heading ??
            `${gaps.length === 1 ? "One quick question" : `${gaps.length} quick questions`} before you see it`}
        </h2>
        <p className="text-muted-foreground">
          {intro ??
            `The job asks for things your notes don't mention. Only say yes if it's true. A "no" stays off your resume and is kept for interview prep.`}
        </p>
      </div>
      {notice}
      {gaps.map((gap) => {
        if (isOwnership(gap.id))
          return (
            <OwnershipQuestion
              key={gap.id}
              id={gap.id}
              question={gap.question}
              value={owners[gap.id] ?? emptyOwnership}
              onChange={(next) => setOwners((all) => ({ ...all, [gap.id]: next }))}
            />
          );
        const choice = choices[gap.id];
        return (
          <Card key={gap.id}>
            <CardHeader>
              <CardTitle id={`q-${gap.id}`} className="font-display text-lg font-medium">
                {gap.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <fieldset className="flex flex-wrap gap-2" aria-labelledby={`q-${gap.id}`}>
                {(
                  [
                    ["yes", "Yes, I have"],
                    ["no", "No"],
                    ["skip", "Skip"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    variant={choice === value ? "default" : "outline"}
                    className={cn("h-11 min-w-20 max-sm:flex-1")}
                    aria-pressed={choice === value}
                    onClick={() => setChoices((all) => ({ ...all, [gap.id]: value }))}
                  >
                    {label}
                  </Button>
                ))}
              </fieldset>
              {choice === "yes" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`d-${gap.id}`}>Where and what? A sentence is enough.</Label>
                  <Textarea
                    id={`d-${gap.id}`}
                    value={details[gap.id] ?? ""}
                    onChange={(event) => setDetails((all) => ({ ...all, [gap.id]: event.target.value }))}
                    placeholder="e.g. Ran it for the archive project's hosting"
                    className="min-h-20"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          stickyActions &&
            "max-md:sticky max-md:bottom-[calc(57px+env(safe-area-inset-bottom))] max-md:z-20 max-md:-mx-5 max-md:border-t max-md:bg-background/95 max-md:px-5 max-md:py-3 max-md:backdrop-blur",
        )}
      >
        <Button className="h-11 max-sm:flex-1" onClick={() => void submit()} disabled={busy}>
          {busy ? "Sending…" : submitLabel}
        </Button>
        <Button
          variant="ghost"
          className="h-11 max-sm:flex-1"
          onClick={() => {
            clearSaved();
            onSkipAll();
          }}
          disabled={busy}
        >
          {skipLabel}
        </Button>
        {stickyActions && (
          <span className="text-sm text-muted-foreground max-sm:basis-full max-sm:text-center" aria-live="polite">
            {answered === 0 ? "Nothing answered yet" : `${answered} of ${gaps.length} answered`}
          </span>
        )}
      </div>
    </section>
  );
}
