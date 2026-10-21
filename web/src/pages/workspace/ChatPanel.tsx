import { SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChatHeader, ChatSkeleton } from "@/components/ChatHeader";
import { Markdown } from "@/components/Markdown";
import { MemoryProposals } from "@/components/MemoryProposals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Message, SavedChat } from "@/lib/use-chat-thread";
import { useDraft } from "@/lib/use-draft";
import { useScrollMemory } from "@/lib/use-scroll-memory";
import { cn } from "@/lib/utils";

/** Simple chat: plain bubbles, and a before/after list for every change the assistant made. */
export function ChatPanel({
  chat,
  intro,
  placeholder = "e.g. Put the strongest work first",
  suggestions = [],
  className,
}: {
  chat: SavedChat;
  intro: string;
  placeholder?: string;
  suggestions?: string[];
  className?: string;
}) {
  const { messages, pending } = chat;
  const [text, setText, clearText] = useDraft(chat.draftKey);
  const log = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useScrollMemory(log, chat.draftKey, !chat.loading, true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a message arrives.
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [messages.length, pending]);
  const submit = () => {
    const message = text.trim();
    if (!message || pending || chat.loading) return;
    clearText();
    void chat.send(message);
  };
  const lastIndex = messages.length - 1;
  return (
    <section aria-label="Chat" className={cn("flex min-h-0 flex-col gap-3", className)}>
      <ChatHeader chat={chat} />
      <div ref={log} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" role="log" aria-live="polite">
        {chat.loading ? (
          <ChatSkeleton />
        ) : (
          <>
            <Bubble from="assistant">{intro}</Bubble>
            {messages.map((message, index) => (
              <Bubble key={message.id} from={message.role}>
                <MessageBody message={message} />
                {message.role === "error" && index === lastIndex && (
                  <Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={chat.retry}>
                    Retry
                  </Button>
                )}
              </Bubble>
            ))}
            {pending && (
              <p className="text-sm text-muted-foreground" role="status">
                Working on it…
              </p>
            )}
          </>
        )}
        <div ref={end} />
      </div>
      {suggestions.length > 0 && messages.length === 0 && !chat.loading && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void chat.send(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          aria-label="Ask for a change"
          placeholder={placeholder}
          className="max-h-32 min-h-11 flex-1"
          rows={1}
        />
        <Button
          type="submit"
          size="icon"
          className="size-11"
          disabled={pending || chat.loading || !text.trim()}
          aria-label="Send"
        >
          <SendHorizontal />
        </Button>
      </form>
    </section>
  );
}

const fieldLabel = (field: string) =>
  ({
    title: "Title",
    subtitle: "Subtitle",
    period: "Dates",
    location: "Location",
    links: "Links",
    headline: "Headline",
  })[field] ?? field;
/** A changed field's new value in plain words: links as their labels, cleared values as "Removed". */
function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Removed";
  if (Array.isArray(value))
    return value
      .map((entry) => (typeof entry === "object" && entry && "label" in entry ? String(entry.label) : String(entry)))
      .join(", ");
  return String(value);
}

/** The text of one turn, with the lines it changed. */
export function MessageBody({ message }: { message: Message }) {
  return (
    <>
      {message.role === "assistant" ? <Markdown text={message.text} /> : message.text}
      {message.changes && message.changes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2 border-t pt-2 text-xs">
          {message.changes.map((change) =>
            change.kind === "field" ? (
              <li key={`${change.id}:${change.field}`} className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">{fieldLabel(change.field)}</span>
                <span>{fieldValue(change.after)}</span>
              </li>
            ) : (
              <li key={change.id} className="flex flex-col gap-0.5">
                {change.before && <span className="text-muted-foreground line-through">{change.before}</span>}
                <span>{change.hidden ? "Hidden from the resume" : change.after}</span>
              </li>
            ),
          )}
        </ul>
      )}
      <MemoryProposals proposals={message.memoryProposals} />
      {message.changes?.length === 0 && message.role === "assistant" && (
        <p className="mt-1 text-xs text-muted-foreground">No lines were changed.</p>
      )}
    </>
  );
}

export function Bubble({ from, children }: { from: Message["role"]; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[92%] rounded-xl border px-3 py-2 text-sm break-words whitespace-pre-line",
        from === "user" ? "self-end bg-secondary text-secondary-foreground" : "self-start bg-card",
        from === "error" && "border-destructive/40 text-destructive",
      )}
    >
      {children}
    </div>
  );
}
