import type { ApplicationResource, JobView } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { useApplicationAnswers, useWriteApplication } from "@/api/queries";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useRememberOwnership } from "./OwnershipQuestion";
import { parseGaps, Questions } from "./Questions";

type Call = { kind: "answers"; answers: Record<string, string> } | { kind: "skip" };

/** The step between pasting a job and the first draft: answer a few questions, or skip them. */
export function QuestionsStep({
  id,
  app,
  failure,
}: {
  id: string;
  app: ApplicationResource;
  /** The last job for this application, when it failed. */
  failure?: JobView;
}) {
  const answers = useApplicationAnswers(id);
  const write = useWriteApplication(id);
  const remember = useRememberOwnership();
  const [last, setLast] = useState<Call | null>(null);
  const run = async (call: Call) => {
    setLast(call);
    try {
      if (call.kind === "answers") await answers.mutateAsync({ answers: call.answers });
      else await write.mutateAsync();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That could not be sent. Please try again.");
    }
  };
  const title = [app.analysis.title, app.analysis.company].filter(Boolean).join(" at ");
  return (
    <Questions
      gaps={parseGaps(app.gaps)}
      pending={answers.isPending || write.isPending}
      heading={
        <>
          A few questions before I write
          {title && <span className="mt-1 block text-base font-medium text-muted-foreground break-words">{title}</span>}
        </>
      }
      intro="Answer what you can. Anything you skip stays out of the resume. Nothing is guessed."
      submitLabel="Write my resume"
      skipLabel="Skip and write now"
      stickyActions
      onRemember={remember}
      onSubmit={(given) => void run({ kind: "answers", answers: given })}
      onSkipAll={() => void run({ kind: "skip" })}
      notice={
        failure && (
          <Alert variant="destructive">
            <AlertTitle>The last try didn't work</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{failure.error ?? "Something went wrong. Please try again."}</span>
              {last && (
                <Button variant="outline" className="h-11" onClick={() => void run(last)}>
                  Retry
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )
      }
    />
  );
}
