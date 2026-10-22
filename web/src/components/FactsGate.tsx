import { useQueryClient } from "@tanstack/react-query";
import type { FactQuestion as Question } from "@vita/shared";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { qualityApi } from "@/api/client";
import { queryKeys } from "@/api/keys";
import { useAnswerFacts } from "@/api/queries";
import {
  emptyFact,
  type FactDraft,
  FactQuestion,
  factAnswer,
  factKindOf,
  factTouched,
} from "@/components/FactQuestion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const skippedKey = "vita:facts-skipped";
const sessionGet = () => {
  try {
    return sessionStorage.getItem(skippedKey) === "1";
  } catch {
    return false;
  }
};
const sessionSet = () => {
  try {
    sessionStorage.setItem(skippedKey, "1");
  } catch {
    /* Asked again next time. */
  }
};

/**
 * Before a base or master is written: if facts are missing (dates, graduation, results), ask up to six of them
 * in a small dialog. Continue saves the answers and then runs the action; Skip for now just runs it, and the
 * choice is remembered for this tab. If the question list can't be loaded, the action runs anyway.
 */
export function useFactsGate(): { run: (proceed: () => void | Promise<void>) => Promise<void>; dialog: ReactNode } {
  const client = useQueryClient();
  const answer = useAnswerFacts();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FactDraft>>({});
  const [attempted, setAttempted] = useState(false);
  const next = useRef<(() => void | Promise<void>) | null>(null);

  const close = () => {
    next.current = null;
    setQuestions(null);
    setDrafts({});
    setAttempted(false);
  };
  const finish = async () => {
    const proceed = next.current;
    close();
    await proceed?.();
  };
  const run = async (proceed: () => void | Promise<void>) => {
    if (sessionGet()) return void (await proceed());
    let missing: Question[] = [];
    try {
      missing = (
        await client.fetchQuery({
          queryKey: queryKeys.factsMissing,
          queryFn: ({ signal }) => qualityApi.facts.missing(signal),
          staleTime: 0,
        })
      ).questions;
    } catch {
      /* Questions are a help, never a blocker. */
    }
    if (!missing.length) return void (await proceed());
    next.current = proceed;
    setDrafts({});
    setAttempted(false);
    setQuestions(missing.slice(0, 6));
  };
  const entries = questions ?? [];
  const draftOf = (id: string) => drafts[id] ?? emptyFact;
  const kindOf = (question: Question) => factKindOf(question.id, question.kind);
  const cont = async () => {
    const unfinished = entries.some(
      (question) => factTouched(draftOf(question.id)) && !factAnswer(kindOf(question), draftOf(question.id)),
    );
    if (unfinished) return void setAttempted(true);
    const given: Record<string, string> = {};
    for (const question of entries) {
      const value = factAnswer(kindOf(question), draftOf(question.id));
      if (value) given[question.id] = value;
    }
    if (Object.keys(given).length) {
      try {
        await answer.mutateAsync({ answers: given });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Your answers could not be saved.");
        return;
      }
    }
    await finish();
  };
  const dialog = (
    <Dialog open={questions !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>A few details make this stronger</DialogTitle>
          <DialogDescription>
            Real dates and results are what a recruiter looks for. Nothing is guessed, and anything you skip stays out.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[55dvh] min-w-0 flex-col gap-3 overflow-y-auto">
          {entries.map((question) => (
            <FactQuestion
              key={question.id}
              id={question.id}
              text={question.text}
              kind={kindOf(question)}
              value={draftOf(question.id)}
              onChange={(value) => setDrafts((all) => ({ ...all, [question.id]: value }))}
              showProblem={attempted && factTouched(draftOf(question.id))}
              disabled={answer.isPending}
            />
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={answer.isPending}
            onClick={() => {
              sessionSet();
              void finish();
            }}
          >
            Skip for now
          </Button>
          <Button type="button" className="h-11" disabled={answer.isPending} onClick={() => void cont()}>
            {answer.isPending ? "Saving…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { run, dialog };
}
