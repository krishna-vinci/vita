import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

/** One card per thing the job asks for that the user's notes do not yet show. */
export function Questions({
  gaps,
  pending,
  onSubmit,
  onSkipAll,
}: {
  gaps: Gap[];
  pending: boolean;
  onSubmit: (answers: Record<string, string>) => void;
  onSkipAll: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [details, setDetails] = useState<Record<string, string>>({});
  const submit = () => {
    const answers: Record<string, string> = {};
    for (const gap of gaps) {
      if (choices[gap.id] === "yes")
        answers[gap.id] = details[gap.id]?.trim() ? `Yes: ${details[gap.id]?.trim()}` : "yes";
      if (choices[gap.id] === "no") answers[gap.id] = "no";
    }
    onSubmit(answers);
  };
  return (
    <section aria-labelledby="questions-title" className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id="questions-title" className="font-display text-2xl font-bold">
          {gaps.length === 1 ? "One quick question" : `${gaps.length} quick questions`} before you see it
        </h2>
        <p className="text-muted-foreground">
          The job asks for things your notes don't mention. Only say yes if it's true. A "no" stays off your resume and
          is kept for interview prep.
        </p>
      </div>
      {gaps.map((gap) => {
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
                    className={cn("h-11 min-w-24")}
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
      <div className="flex flex-wrap gap-3">
        <Button className="h-11" onClick={submit} disabled={pending}>
          {pending ? "Sending…" : "Continue"}
        </Button>
        <Button variant="ghost" className="h-11" onClick={onSkipAll} disabled={pending}>
          Skip and show my resume
        </Button>
      </div>
    </section>
  );
}
