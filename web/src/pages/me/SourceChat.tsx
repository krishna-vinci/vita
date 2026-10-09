import type { SourceProposal } from "@vita/shared";
import { SendHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApplySource, useSourceChat } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { Diff } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Turn {
  role: "user" | "assistant" | "error";
  text: string;
  proposal?: SourceProposal | null;
  state?: "open" | "accepted" | "discarded";
}

const fileName = { outline: "your outline", projects: "your projects" } as const;

/** Ask for a change in plain words; edits arrive as a proposal you accept or discard. Nothing is written until then. */
export function SourceChat({ dirty, className }: { dirty: boolean; className?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const chat = useSourceChat();
  const apply = useApplySource();
  const update = (index: number, patch: Partial<Turn>) =>
    setTurns((all) => all.map((turn, at) => (at === index ? { ...turn, ...patch } : turn)));
  const send = async () => {
    const message = text.trim();
    if (!message || chat.isPending) return;
    setText("");
    setTurns((all) => [...all, { role: "user", text: message }]);
    try {
      const reply = await chat.mutateAsync(message);
      setTurns((all) => [
        ...all,
        { role: "assistant", text: reply.reply, proposal: reply.proposal, state: reply.proposal ? "open" : undefined },
      ]);
    } catch (error) {
      setTurns((all) => [
        ...all,
        { role: "error", text: error instanceof Error ? error.message : "That didn't work. Please try again." },
      ]);
    }
  };
  return (
    <section aria-label="Chat" className={cn("flex min-h-0 flex-col gap-3", className)}>
      <h2 className="font-display text-lg font-medium">Ask for a change</h2>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" role="log" aria-live="polite">
        <Bubble from="assistant">
          Tell me what to add or fix, like "I moved backups to Restic last year". I'll show you the change first.
        </Bubble>
        {turns.map((turn, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <Bubble key={index} from={turn.role}>
            {turn.role === "assistant" ? <Markdown text={turn.text} /> : turn.text}
            {turn.proposal && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Proposed change to {fileName[turn.proposal.file]}
                </p>
                {turn.proposal.summary && <Markdown text={turn.proposal.summary} className="text-sm" />}
                <Diff before={turn.proposal.before} after={turn.proposal.after} />
                {turn.state === "open" ? (
                  <>
                    {dirty && <p className="text-xs text-warning">Save your own edits first, then accept.</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={dirty || apply.isPending}
                        onClick={async () => {
                          if (!turn.proposal) return;
                          try {
                            await apply.mutateAsync(turn.proposal);
                            update(index, { state: "accepted" });
                            toast.success("Change added.");
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Could not apply the change.");
                          }
                        }}
                      >
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => update(index, { state: "discarded" })}>
                        Discard
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{turn.state === "accepted" ? "Added." : "Discarded."}</p>
                )}
              </div>
            )}
          </Bubble>
        ))}
        {chat.isPending && (
          <p className="text-sm text-muted-foreground" role="status">
            Working on it…
          </p>
        )}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          aria-label="Ask for a change"
          placeholder="Add that I…"
          className="max-h-32 min-h-11 flex-1"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11"
          disabled={chat.isPending || !text.trim()}
          aria-label="Send"
        >
          <SendHorizontal />
        </Button>
      </form>
    </section>
  );
}

function Bubble({ from, children }: { from: Turn["role"]; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[96%] rounded-xl border px-3 py-2 text-sm break-words whitespace-pre-line",
        from === "user" ? "self-end bg-secondary text-secondary-foreground" : "self-start bg-card",
        from === "error" && "border-destructive/40 text-destructive",
      )}
    >
      {children}
    </div>
  );
}
