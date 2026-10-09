import type { FitResponse, Resume } from "@vita/shared";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { allBullets } from "@/lib/resume-view";

export interface FitState {
  pages: number;
  loading: boolean;
  ops?: FitResponse;
  error?: string;
}

const words = (key: string) => key.replace(/[_.-]+/g, " ");

/** Proposed changes to fit the page limit, in plain words. Nothing happens until Apply. */
export function FitDialog({
  state,
  resume,
  applying,
  onApply,
  onClose,
}: {
  state: FitState | null;
  resume: Resume;
  applying: boolean;
  onApply: (ops: FitResponse) => void;
  onClose: () => void;
}) {
  const bullets = new Map(allBullets(resume).map((bullet) => [bullet.id, bullet.text]));
  const snippet = (text = "") => (text.length > 70 ? `${text.slice(0, 70)}…` : text);
  return (
    <Dialog open={!!state} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fit to {state?.pages === 1 ? "one page" : `${state?.pages} pages`}</DialogTitle>
          <DialogDescription>Here's what Vita would change. You can undo it afterwards.</DialogDescription>
        </DialogHeader>
        {state?.loading ? (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Trying layouts…
          </p>
        ) : state?.error ? (
          <p className="text-destructive">{state.error}</p>
        ) : state?.ops?.length === 0 ? (
          <p>It already fits. Nothing needs to change.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pl-5 text-sm">
            {state?.ops?.map((op) => (
              <li key={op.op === "layout.set" ? `l-${op.key}` : `h-${op.id}`} className="list-disc break-words">
                {op.op === "layout.set"
                  ? `Adjust ${words(op.key)} to ${op.value}`
                  : `Hide: "${snippet(bullets.get(op.id))}"`}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!!state?.ops?.length && (
            <Button disabled={applying} onClick={() => state.ops && onApply(state.ops)}>
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
