import type { SourceProposal } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { useAnswerMetric, useDismissMetric, useMetricQuestions } from "@/api/queries";
import { ProposalReview } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** "Got a minute?": one measuring question at a time. Real numbers only, from you. */
export function MetricCard() {
  const query = useMetricQuestions();
  const answer = useAnswerMetric();
  const dismiss = useDismissMetric();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [proposal, setProposal] = useState<SourceProposal | null>(null);
  const question = query.data?.find((entry) => !skipped.includes(entry.id));
  if (!question && !proposal) return null;
  const next = () => {
    setProposal(null);
    setText("");
    void query.refetch();
  };
  if (proposal)
    return (
      <section aria-label="Got a minute?" className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-card p-5">
        <p className="font-medium">Thanks. Here's what I'd add.</p>
        <ProposalReview proposal={proposal} onDone={() => next()} />
      </section>
    );
  if (!question) return null;
  return (
    <section aria-label="Got a minute?" className="flex max-w-2xl flex-col gap-3 rounded-xl border bg-card p-5">
      <p className="text-sm font-medium text-primary">Got a minute?</p>
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-lg font-medium break-words">
          {question.question.startsWith(question.itemName)
            ? question.question
            : `${question.itemName}: ${question.question}`}
        </h2>
        <p className="text-sm text-muted-foreground">{question.why}</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            setProposal(
              await answer.mutateAsync({ questionId: question.id, answer: text.trim(), claimId: question.claimId }),
            );
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not use that answer.");
          }
        }}
      >
        <Label htmlFor="metric-answer" className="sr-only">
          Your answer
        </Label>
        <Textarea
          id="metric-answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="A rough, honest answer is fine. Say 'not sure' if you don't know."
          className="min-h-20"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="h-11" disabled={!text.trim() || answer.isPending}>
            {answer.isPending ? "Working on it…" : "Answer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(question.id, { onError: (error) => toast.error(error.message) })}
          >
            Not now
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => setSkipped((all) => [...all, question.id])}
          >
            Skip
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          "Not now" removes this question. "Skip" just moves on and it can come back later.
        </p>
      </form>
    </section>
  );
}
