import { SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { MemoryProposals } from "@/components/MemoryProposals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Message } from "./useChatThread";

/** Simple chat: plain bubbles, and a before/after list for every change the assistant made. */
export function ChatPanel({
  messages,
  pending,
  onSend,
  intro,
  suggestions = [],
  className,
}: {
  messages: Message[];
  pending: boolean;
  onSend: (message: string) => void;
  intro: string;
  suggestions?: string[];
  className?: string;
}) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever a message arrives.
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [messages.length, pending]);
  const submit = () => {
    const message = text.trim();
    if (!message || pending) return;
    setText("");
    onSend(message);
  };
  return (
    <section aria-label="Chat" className={cn("flex min-h-0 flex-col gap-3", className)}>
      <h2 className="font-display text-lg font-medium">Ask for a change</h2>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" role="log" aria-live="polite">
        <Bubble from="assistant">{intro}</Bubble>
        {messages.map((message, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <Bubble key={index} from={message.role}>
            {message.role === "assistant" ? <Markdown text={message.text} /> : message.text}
            {message.changes && message.changes.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 border-t pt-2 text-xs">
                {message.changes.map((change) => (
                  <li key={change.id} className="flex flex-col gap-0.5">
                    {change.before && <span className="text-muted-foreground line-through">{change.before}</span>}
                    <span>{change.hidden ? "Hidden from the resume" : change.after}</span>
                  </li>
                ))}
              </ul>
            )}
            <MemoryProposals proposals={message.memoryProposals} />
            {message.changes?.length === 0 && message.role === "assistant" && (
              <p className="mt-1 text-xs text-muted-foreground">No lines were changed.</p>
            )}
          </Bubble>
        ))}
        {pending && (
          <p className="text-sm text-muted-foreground" role="status">
            Working on it…
          </p>
        )}
        <div ref={end} />
      </div>
      {suggestions.length > 0 && messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <Button key={suggestion} size="sm" variant="outline" disabled={pending} onClick={() => onSend(suggestion)}>
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
          placeholder="e.g. Put the strongest work first"
          className="max-h-32 min-h-11 flex-1"
          rows={1}
        />
        <Button type="submit" size="icon" className="size-11" disabled={pending || !text.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
    </section>
  );
}

function Bubble({ from, children }: { from: Message["role"]; children: React.ReactNode }) {
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
