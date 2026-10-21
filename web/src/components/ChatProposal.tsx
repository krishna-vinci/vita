import type { SourceProposal } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { Diff } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";
import type { Message } from "@/lib/use-chat-thread";

const fileName = { outline: "your outline", projects: "your projects" } as const;

/**
 * A proposed change to your own files, saved in the chat. Past ones show their diff and whether they were
 * added. One written against an older version of the file cannot be added: ask again.
 */
export function ChatProposal({
  message,
  threadId,
  blocked,
  apply,
  onDone,
}: {
  message: Message;
  threadId: string | null;
  /** Set when unsaved edits would clash with the change. */
  blocked?: boolean;
  apply: (proposal: SourceProposal, ids: { messageId?: string; threadId?: string }) => Promise<unknown>;
  onDone?: (accepted: boolean) => void;
}) {
  const proposal = message.proposal;
  const [local, setLocal] = useState<"added" | "discarded" | "stale" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!proposal) return null;
  const state = message.applied ? "added" : local;
  const run = async () => {
    setBusy(true);
    try {
      await apply(proposal, threadId ? { messageId: message.id, threadId } : {});
      setLocal("added");
      toast.success("Change added.");
      onDone?.(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && ["stale-hash", "proposal-mismatch"].includes(error.code))
        setLocal("stale");
      else toast.error(error instanceof Error ? error.message : "Could not apply the change.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Proposed change to {fileName[proposal.file]}</p>
      {proposal.summary && <Markdown text={proposal.summary} className="text-sm" />}
      <Diff before={proposal.before} after={proposal.after} />
      {state === null ? (
        <>
          {blocked && <p className="text-xs text-warning">Save your own edits first, then accept.</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={blocked || busy} onClick={() => void run()}>
              Accept
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLocal("discarded");
                onDone?.(false);
              }}
            >
              Discard
            </Button>
          </div>
        </>
      ) : state === "stale" ? (
        <>
          <p className="text-xs text-warning">This suggestion is out of date. Ask again.</p>
          <div>
            <Button size="sm" disabled>
              Accept
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{state === "added" ? "Added." : "Discarded."}</p>
      )}
    </div>
  );
}
