import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { DeleteDialog } from "@/components/DeleteDialog";
import { RestoredNote } from "@/components/LeaveGuard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** The save row every card shares: Save and Cancel appear only when there is something to save. */
export function SaveBar({
  dirty,
  saving,
  canSave,
  error,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(dirty || saving) && (
        <div className="flex flex-wrap gap-3">
          <Button type="button" className="h-11" disabled={!canSave || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" className="h-11" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </>
  );
}

/** A collapsible card: the summary line when closed, the fields when open. */
export function EntryCard({
  card,
  title,
  summary,
  chips,
  open,
  onToggle,
  dirty,
  restored,
  onDiscardRestored,
  focusField,
  deleteName,
  onDelete,
  children,
}: {
  /** Key like `project:my-app`; also names the field ids used by "jump to". */
  card: string;
  title: string;
  summary?: string;
  chips?: ReactNode;
  open: boolean;
  onToggle: () => void;
  dirty: boolean;
  restored: boolean;
  onDiscardRestored: () => void;
  /** An element id to focus once the card is open (from "Make your resumes stronger"). */
  focusField?: { id: string } | null;
  deleteName?: string;
  onDelete?: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  // `focusField` is a new object on every jump, even to the same field, so it re-runs the effect.
  useEffect(() => {
    if (!open || !focusField) return;
    const timer = setTimeout(() => {
      const element = document.getElementById(focusField.id);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [open, focusField]);
  const bodyId = `${card.replace(/[^a-zA-Z0-9_-]/g, "-")}-body`;
  return (
    <Card className="gap-0 py-0" data-card={card}>
      <div className="flex items-start gap-2 p-4 sm:p-5">
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="flex max-w-full flex-wrap items-center gap-2">
            <span className="font-display text-base font-semibold break-words">{title}</span>
            {dirty && <Badge variant="outline">Unsaved changes</Badge>}
          </span>
          {summary && <span className="text-sm break-words text-muted-foreground">{summary}</span>}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          aria-label={open ? `Close ${title}` : `Edit ${title}`}
          onClick={onToggle}
        >
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
      {!open && chips && <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">{chips}</div>}
      {open && (
        <div id={bodyId} className="flex flex-col gap-6 border-t p-4 sm:p-5">
          {restored && <RestoredNote onDiscard={onDiscardRestored} />}
          {children}
          {onDelete && deleteName && (
            <div className="border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-destructive"
                onClick={() => setConfirming(true)}
              >
                Delete {deleteName}
              </Button>
              <DeleteDialog open={confirming} onOpenChange={setConfirming} name={deleteName} onConfirm={onDelete} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
