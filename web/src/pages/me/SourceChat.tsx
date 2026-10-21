import { SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useApplySource, useSourceChat } from "@/api/queries";
import { ChatHeader, ChatSkeleton } from "@/components/ChatHeader";
import { ChatProposal } from "@/components/ChatProposal";
import { Markdown } from "@/components/Markdown";
import { MemoryProposals } from "@/components/MemoryProposals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSavedChat } from "@/lib/use-chat-thread";
import { useDraft } from "@/lib/use-draft";
import { useScrollMemory } from "@/lib/use-scroll-memory";
import { Bubble } from "../workspace/ChatPanel";

/** Ask for a change in plain words; edits arrive as a proposal you accept or discard. Nothing is written until then. */
export function SourceChat({ dirty, className }: { dirty: boolean; className?: string }) {
  const reply = useSourceChat();
  const apply = useApplySource();
  const chat = useSavedChat("source", "outline-projects", (message, threadId) =>
    reply.mutateAsync({ message, threadId }),
  );
  const [text, setText, clearText] = useDraft(chat.draftKey);
  const log = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useScrollMemory(log, chat.draftKey, !chat.loading, true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a message arrives.
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [chat.messages.length, chat.pending]);
  const send = () => {
    const message = text.trim();
    if (!message || chat.pending || chat.loading) return;
    clearText();
    void chat.send(message);
  };
  const last = chat.messages.length - 1;
  return (
    <section aria-label="Chat" className={`flex min-h-0 flex-col gap-3 ${className ?? ""}`}>
      <ChatHeader chat={chat} />
      <div ref={log} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" role="log" aria-live="polite">
        {chat.loading ? (
          <ChatSkeleton />
        ) : (
          <>
            <Bubble from="assistant">
              Tell me what to add or fix, like "I moved backups to Restic last year". I'll show you the change first.
            </Bubble>
            {chat.messages.map((message, index) => (
              <Bubble key={message.id} from={message.role}>
                {message.role === "assistant" ? <Markdown text={message.text} /> : message.text}
                <MemoryProposals proposals={message.memoryProposals} />
                <ChatProposal
                  message={message}
                  threadId={chat.threadId}
                  blocked={dirty}
                  apply={(proposal, ids) => apply.mutateAsync({ proposal, ids })}
                />
                {message.role === "error" && index === last && (
                  <Button size="sm" variant="outline" className="mt-2" disabled={chat.pending} onClick={chat.retry}>
                    Retry
                  </Button>
                )}
              </Bubble>
            ))}
            {chat.pending && (
              <p className="text-sm text-muted-foreground" role="status">
                Working on it…
              </p>
            )}
          </>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
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
          disabled={chat.pending || chat.loading || !text.trim()}
          aria-label="Send"
        >
          <SendHorizontal />
        </Button>
      </form>
    </section>
  );
}
