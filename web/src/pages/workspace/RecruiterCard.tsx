import type { FactQuestion as Question, RecruiterFinding, RecruiterReview } from "@vita/shared";
import {
  ArrowDownUp,
  CalendarClock,
  ChevronDown,
  Compass,
  type LucideIcon,
  PenLine,
  RefreshCw,
  Target,
  TrendingUp,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useAnswerFacts, useApplyFinding, useResumeInstructions } from "@/api/queries";
import { emptyFact, type FactDraft, FactQuestion, factAnswer, factKindOf } from "@/components/FactQuestion";
import { Button } from "@/components/ui/button";

const areas: Record<RecruiterFinding["area"], { label: string; icon: LucideIcon }> = {
  purpose: { label: "Purpose", icon: Target },
  results: { label: "Results", icon: TrendingUp },
  timeline: { label: "Timeline", icon: CalendarClock },
  wording: { label: "Wording", icon: PenLine },
  positioning: { label: "Positioning", icon: Compass },
  order: { label: "Order", icon: ArrowDownUp },
  skills: { label: "Skills", icon: Wrench },
};
const severityRank = { high: 0, medium: 1, low: 2 } as const;
const topCount = 3;

/** 8+ green, 6 to 7 amber, 5 or less red. Quiet: only the number is coloured. */
export function scoreTone(score: number): string {
  return score >= 8 ? "text-success" : score >= 6 ? "text-warning" : "text-destructive";
}

type Scope = "application" | "resume";

// Dismissed findings are remembered per resume in localStorage.
const storeKey = (scope: Scope, id: string) => `vita:dismissed-findings:${scope}:${id}`;
function readSet(key: string): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
function writeSet(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* Dismissals just aren't remembered. */
  }
}

/** The recruiter's score, one line, and the top findings, each with the one thing you can do about it. */
export function RecruiterCard({
  scope,
  id,
  review,
  instructions,
  onUndo,
}: {
  scope: Scope;
  id: string;
  review: RecruiterReview | undefined;
  /** The resume's standing instructions, kept when it is regenerated. */
  instructions: string;
  /** Undoes the last change to this resume. */
  onUndo: () => void;
}) {
  const key = storeKey(scope, id);
  const [hidden, setHidden] = useState(() => readSet(key));
  const [all, setAll] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  if (!review) return null;
  const hide = (findingId: string) => {
    const next = [...new Set([...hidden, findingId])];
    setHidden(next);
    writeSet(key, next);
  };
  const show = (findingId: string) => {
    const next = hidden.filter((entry) => entry !== findingId);
    setHidden(next);
    writeSet(key, next);
  };
  const open = review.findings
    .filter((finding) => !hidden.includes(finding.id))
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => severityRank[a.finding.severity] - severityRank[b.finding.severity] || a.index - b.index)
    .map((entry) => entry.finding);
  const shown = all ? open : open.slice(0, topCount);
  return (
    <section aria-label="Recruiter review" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="font-display text-xl font-bold">
          Score <span className={scoreTone(review.score)}>{review.score}</span>
          <span className="text-muted-foreground">/10</span>
        </p>
        <p className="min-w-0 flex-1 basis-60 text-sm text-muted-foreground">{review.summary}</p>
      </div>
      {open.length > 0 && (
        <ul className="flex flex-col divide-y">
          {shown.map((finding) => (
            <Finding
              key={finding.id}
              scope={scope}
              id={id}
              finding={finding}
              instructions={instructions}
              asking={asking === finding.id}
              saved={saved.includes(finding.id)}
              onAsk={(on) => setAsking(on ? finding.id : null)}
              onSaved={() => {
                setAsking(null);
                setSaved((list) => [...list, finding.id]);
              }}
              onDismiss={() => hide(finding.id)}
              onApplied={() => {
                hide(finding.id);
                toast.success("Applied", {
                  action: {
                    label: "Undo",
                    onClick: () => {
                      show(finding.id);
                      onUndo();
                    },
                  },
                  duration: 10_000,
                });
              }}
            />
          ))}
        </ul>
      )}
      {open.length > topCount && (
        <Button
          variant="ghost"
          className="h-11 w-fit px-2 text-muted-foreground"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          <ChevronDown className={all ? "rotate-180" : ""} /> {all ? "Show fewer" : `See all (${open.length})`}
        </Button>
      )}
    </section>
  );
}

function Finding({
  scope,
  id,
  finding,
  instructions,
  asking,
  saved,
  onAsk,
  onSaved,
  onDismiss,
  onApplied,
}: {
  scope: Scope;
  id: string;
  finding: RecruiterFinding;
  instructions: string;
  asking: boolean;
  saved: boolean;
  onAsk: (on: boolean) => void;
  onSaved: () => void;
  onDismiss: () => void;
  onApplied: () => void;
}) {
  const area = areas[finding.area];
  const Icon = area.icon;
  const apply = useApplyFinding(scope, id);
  const answerFacts = useAnswerFacts();
  const regenerate = useResumeInstructions(scope, id);
  const [draft, setDraft] = useState<FactDraft>(emptyFact);
  const [attempted, setAttempted] = useState(false);
  const [problem, setProblem] = useState("");
  // The question is on the finding, or comes back from the server when applying says an answer is needed.
  const [fetched, setFetched] = useState<Question | null>(null);
  const question = finding.fix && "question" in finding.fix ? finding.fix.question : fetched;
  const ops = finding.fix && "ops" in finding.fix;
  const kind = question ? factKindOf(question.id, question.kind) : "other";

  const doApply = () => {
    setProblem("");
    apply.mutate(finding.id, {
      onSuccess: onApplied,
      onError: (error) => {
        const details = error instanceof ApiError ? (error.details as { question?: Question } | undefined) : undefined;
        if (
          error instanceof ApiError &&
          error.status === 409 &&
          error.code === "answer-required" &&
          details?.question
        ) {
          setFetched(details.question);
          onAsk(true);
          return;
        }
        setProblem(error.message || "That change didn't work.");
      },
    });
  };
  const save = async () => {
    if (!question) return;
    const answer = factAnswer(kind, draft);
    if (!answer) return void setAttempted(true);
    try {
      await answerFacts.mutateAsync({ answers: { [question.id]: answer } });
      toast.success(answer === "skip" ? "Skipped." : "Saved to your information.");
      setDraft(emptyFact);
      setAttempted(false);
      onSaved();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Your answer could not be saved.");
    }
  };
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm break-words">
            <span className="font-medium">{area.label}</span>
            <span className="block text-muted-foreground">{finding.message}</span>
          </p>
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {saved ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Saved.</span>
              <Button
                variant="outline"
                className="h-11"
                disabled={regenerate.isPending}
                onClick={() =>
                  regenerate.mutate(
                    { instructions, regenerate: true },
                    {
                      onSuccess: () => toast.success("Rewriting with your answer."),
                      onError: (error) => toast.error(error.message),
                    },
                  )
                }
              >
                <RefreshCw /> Regenerate to use this
              </Button>
              <Button variant="ghost" className="h-11 text-muted-foreground" onClick={onDismiss}>
                Dismiss
              </Button>
            </div>
          ) : asking && question ? (
            <div className="flex flex-col gap-2">
              <FactQuestion
                id={question.id}
                text={question.text}
                kind={kind}
                value={draft}
                onChange={setDraft}
                showProblem={attempted}
                disabled={answerFacts.isPending}
              />
              <div className="flex flex-wrap gap-2">
                <Button className="h-11" disabled={answerFacts.isPending} onClick={() => void save()}>
                  {answerFacts.isPending ? "Saving…" : draft.skipped ? "Save skip" : "Save answer"}
                </Button>
                <Button variant="ghost" className="h-11" onClick={() => onAsk(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ops && (
                <Button className="h-11" disabled={apply.isPending} onClick={doApply}>
                  {apply.isPending ? "Applying…" : "Apply"}
                </Button>
              )}
              {question && (
                <Button className="h-11" onClick={() => onAsk(true)}>
                  Answer
                </Button>
              )}
              <Button variant="ghost" className="h-11 text-muted-foreground" onClick={onDismiss}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
