import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "@/api/client";
import { ChatHeader, ChatSkeleton } from "@/components/ChatHeader";
import { ChatProposal } from "@/components/ChatProposal";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSavedChat } from "@/lib/use-chat-thread";
import { useDraft } from "@/lib/use-draft";
import { useScrollMemory } from "@/lib/use-scroll-memory";
import { Bubble } from "../workspace/ChatPanel";

const intro =
  "Hi! Tell me about the work you're proudest of, or what you do day to day. I'll ask follow-ups and write it up for you.";

/** A few friendly questions. After each answer you see the exact change to your files, and decide. Reopening continues. */
export function InterviewFlow() {
  const client = useQueryClient();
  const reply = useMutation({
    mutationFn: ({ message, threadId }: { message: string; threadId?: string }) =>
      api.onboarding.chat(message, threadId),
  });
  const chat = useSavedChat("onboarding", "interview", (message, threadId) => reply.mutateAsync({ message, threadId }));
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
    <div className="flex flex-col gap-3">
      <ChatHeader chat={chat} />
      <div ref={log} className="flex max-h-[60dvh] flex-col gap-2 overflow-y-auto" role="log" aria-live="polite">
        {chat.loading ? (
          <ChatSkeleton />
        ) : (
          <>
            <Bubble from="assistant">
              <Markdown text={intro} />
            </Bubble>
            {chat.messages.map((message, index) => (
              <Bubble key={message.id} from={message.role}>
                {message.role === "assistant" ? <Markdown text={message.text} /> : message.text}
                <ChatProposal
                  message={message}
                  threadId={chat.threadId}
                  apply={async (proposal, ids) => {
                    await api.onboarding.chatApply(proposal, ids);
                    await client.invalidateQueries();
                  }}
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
                Thinking…
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
          aria-label="Your answer"
          placeholder="Type your answer…"
          className="max-h-32 min-h-11 flex-1"
          rows={2}
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
    </div>
  );
}
