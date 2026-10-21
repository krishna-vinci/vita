import type { TemplateDesignResult } from "@vita/shared";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { DiffView } from "@/components/DiffView";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const examples = [
  "Add icons to the header",
  "Accent-coloured section rules",
  "Skills in two columns",
  "Footer with page numbers",
];

const cost = (usage: TemplateDesignResult["usage"]) => {
  const total = usage.reduce((sum, row) => sum + row.costUsd, 0);
  return total > 0 ? `$${total < 0.01 ? total.toFixed(4) : total.toFixed(2)}` : null;
};

/** Ask the designer for a change. Nothing is saved until you press Apply. */
export function StudioDesign({
  disabledReason,
  pending,
  error,
  result,
  applying,
  applyError,
  canApply,
  onSend,
  onApply,
  onDiscard,
}: {
  /** Why the request is blocked ("Save first"), or null. */
  disabledReason: string | null;
  pending: boolean;
  /** Why the last request failed, such as a template that did not compile. */
  error: string | null;
  result: TemplateDesignResult | null;
  applying: boolean;
  applyError: string | null;
  canApply: boolean;
  onSend: (message: string) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [message, setMessage] = useState("");
  const blocked = !!disabledReason;
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-1">
      {result && (
        <section aria-label="Proposed design" className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Proposed change</h3>
            {cost(result.usage) && <p className="text-xs text-muted-foreground">Cost {cost(result.usage)}</p>}
          </div>
          {/^@@/m.test(result.diff) ? (
            <DiffView diff={result.diff} />
          ) : (
            <p className="text-sm text-muted-foreground">The designer changed nothing.</p>
          )}
          <a
            href={result.previewUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-sm text-primary underline underline-offset-2"
          >
            Open the preview in a new tab
          </a>
          {applyError && (
            <Alert variant="destructive">
              <AlertDescription className="break-words whitespace-pre-wrap">{applyError}</AlertDescription>
            </Alert>
          )}
          {!canApply && (
            <p className="text-sm text-muted-foreground">Save or discard your own edits before you apply this.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button className="h-11" disabled={applying || !canApply} onClick={onApply}>
              {applying ? "Applying…" : "Apply"}
            </Button>
            <Button variant="outline" className="h-11" disabled={applying} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </section>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (message.trim() && !blocked && !pending) onSend(message.trim());
        }}
      >
        <Label htmlFor="design-message">What should change in the design?</Label>
        <Textarea
          id="design-message"
          value={message}
          rows={3}
          maxLength={20_000}
          placeholder="Describe the look you want."
          onChange={(event) => setMessage(event.target.value)}
        />
        <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Examples</legend>
          {examples.map((example) => (
            <Button
              key={example}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-xs"
              onClick={() => setMessage(example)}
            >
              {example}
            </Button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="h-11" disabled={blocked || pending || !message.trim()}>
            {pending ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Sparkles aria-hidden="true" />
            )}
            {pending ? "Designing…" : "Send"}
          </Button>
          {disabledReason && <p className="text-sm text-muted-foreground">{disabledReason}</p>}
        </div>
        {error && !pending && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>The designer's change didn't work, so nothing was changed. Try again or word it differently.</p>
              <pre className="mt-1 max-h-32 w-full overflow-auto font-mono text-xs whitespace-pre-wrap">{error}</pre>
            </AlertDescription>
          </Alert>
        )}
        {pending && (
          <p className="text-sm text-muted-foreground" role="status">
            The designer is changing the template and checking that it compiles. This can take a minute.
          </p>
        )}
      </form>
    </div>
  );
}
