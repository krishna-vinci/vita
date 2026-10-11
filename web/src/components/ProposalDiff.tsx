import type { SourceProposal } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { useApplySource } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { changedLines } from "@/lib/diff";

const fileName = { outline: "your outline", projects: "your projects" } as const;

/** Before and after as plain text: removed lines struck through, added lines marked. */
export function Diff(props: { before: string; after: string }) {
  const { before, after } = changedLines(props.before, props.after);
  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-md border bg-background p-2 font-mono text-xs break-words whitespace-pre-wrap">
      {before && (
        <p className="rounded-sm bg-destructive/10 px-1 text-destructive line-through decoration-destructive/40">
          <span className="sr-only">Removed: </span>
          {before}
        </p>
      )}
      {after && (
        <p className="rounded-sm bg-success/15 px-1 text-success">
          <span className="sr-only">Added: </span>
          {after}
        </p>
      )}
    </div>
  );
}

/** A proposed change to your own files. Nothing is written until you accept. */
export function ProposalReview({
  proposal,
  blocked,
  onDone,
  apply: applyOverride,
}: {
  proposal: SourceProposal;
  /** Set when unsaved edits would clash with the change. */
  blocked?: boolean;
  onDone: (accepted: boolean) => void;
  /** Use a different apply route (for example the onboarding one). */
  apply?: (proposal: SourceProposal) => Promise<unknown>;
}) {
  const apply = useApplySource();
  const [state, setState] = useState<"open" | "accepted" | "discarded">("open");
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Proposed change to {fileName[proposal.file]}</p>
      {proposal.summary && <Markdown text={proposal.summary} className="text-sm" />}
      <Diff before={proposal.before} after={proposal.after} />
      {state === "open" ? (
        <>
          {blocked && <p className="text-xs text-warning">Save your own edits first, then accept.</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={blocked || apply.isPending}
              onClick={async () => {
                try {
                  await (applyOverride ? applyOverride(proposal) : apply.mutateAsync(proposal));
                  setState("accepted");
                  toast.success("Added.");
                  onDone(true);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not apply the change.");
                }
              }}
            >
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setState("discarded");
                onDone(false);
              }}
            >
              Discard
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{state === "accepted" ? "Added." : "Discarded."}</p>
      )}
    </div>
  );
}
