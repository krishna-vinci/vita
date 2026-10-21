import type { JobView } from "@vita/shared";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { progressStep, progressSteps } from "@/lib/resume-view";
import { cn } from "@/lib/utils";

/** Plain-word progress for a running job. Internal stage names never reach the page. */
export function JobProgress({ job, title, onCancel }: { job: JobView; title: string; onCancel?: () => void }) {
  const foundQuestions = job.progress.startsWith("needs-answers");
  const current = job.status === "queued" ? -1 : Math.max(progressStep(job.progress), 0);
  return (
    <section aria-labelledby="progress-title" className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      <div className="flex flex-col gap-2">
        <h2 id="progress-title" className="font-display text-2xl font-bold">
          {title}
        </h2>
        <p className="text-muted-foreground" role="status" aria-live="polite">
          {job.status === "queued"
            ? "Waiting for a turn…"
            : foundQuestions
              ? "Found a few questions"
              : `${progressSteps[current]}…`}
        </p>
      </div>
      <ol className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        {progressSteps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          return (
            <li
              key={step}
              aria-current={state === "current" ? "step" : undefined}
              className={cn("flex items-center gap-3", state === "todo" && "text-muted-foreground")}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs",
                  state === "done" && "border-success bg-success text-background",
                  state === "current" && "border-primary text-primary",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3.5" />
                ) : state === "current" ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : null}
              </span>
              <span className="sr-only">{state === "done" ? "Done: " : state === "current" ? "Now: " : "Later: "}</span>
              {step}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground">This usually takes a minute or two. You can leave and come back.</p>
      {onCancel && (
        <Button variant="outline" className="h-11 w-fit" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </section>
  );
}
