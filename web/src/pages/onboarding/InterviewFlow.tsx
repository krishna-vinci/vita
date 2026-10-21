import { useQueryClient } from "@tanstack/react-query";
import type { SourceProposal } from "@vita/shared";
import { SendHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { Markdown } from "@/components/Markdown";
import { ProposalReview } from "@/components/ProposalDiff";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "@/lib/use-draft";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: SourceProposal | null;
}

/** A few friendly questions. After each answer you see the exact change to your files, and decide. */
export function InterviewFlow() {
  const [turns, setTurns] = useState<Turn[]>([
    {
      id: "intro",
      role: "assistant",
      text: "Hi! Tell me about the work you're proudest of, or what you do day to day. I'll ask follow-ups and write it up for you.",
    },
  ]);
  const [text, setText, clearText] = useDraft("chat:interview");
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    clearText();
    setTurns((all) => [...all, { id: crypto.randomUUID(), role: "user", text: message }]);
    setBusy(true);
    try {
      const reply = await api.onboarding.chat(message);
      setTurns((all) => [
        ...all,
        { id: crypto.randomUUID(), role: "assistant", text: reply.reply, proposal: reply.proposal },
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto" role="log" aria-live="polite">
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`max-w-[92%] rounded-xl border px-3 py-2 text-sm ${turn.role === "user" ? "self-end bg-secondary text-secondary-foreground" : "self-start bg-card"}`}
          >
            {turn.role === "assistant" ? <Markdown text={turn.text} /> : turn.text}
            {turn.proposal && (
              <div className="mt-3">
                <ProposalReview
                  proposal={turn.proposal}
                  apply={async (proposal) => {
                    await api.onboarding.chatApply(proposal);
                    await client.invalidateQueries();
                  }}
                  onDone={() => {}}
                />
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="text-sm text-muted-foreground" role="status">
            Thinking…
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
          aria-label="Your answer"
          placeholder="Type your answer…"
          className="max-h-32 min-h-11 flex-1"
          rows={2}
        />
        <Button type="submit" size="icon" className="size-11" disabled={busy || !text.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
