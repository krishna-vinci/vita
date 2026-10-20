import { useState } from "react";
import { toast } from "sonner";
import { useResumeInstructions } from "@/api/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const instructionExamples =
  "e.g. Lead with backend and infrastructure work. Keep it to one page. Leave out Kite Algo.";

/** Edit the standing instructions for one resume, save them, or save and rewrite. */
export function InstructionsDialog({
  open,
  onOpenChange,
  scope,
  id,
  saved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "application" | "resume";
  id: string;
  saved: string;
}) {
  const [draft, setDraft] = useState(saved);
  const save = useResumeInstructions(scope, id);
  const run = (regenerate: boolean) =>
    save.mutate(
      { instructions: draft.trim(), regenerate },
      {
        onSuccess: () => {
          toast.success(regenerate ? "Rewriting with your instructions." : "Instructions saved.");
          onOpenChange(false);
        },
      },
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(saved);
          save.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instructions for this resume</DialogTitle>
          <DialogDescription>
            Vita follows these whenever it writes this resume. They never override the honesty checks.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="resume-instructions">Instructions</Label>
          <Textarea
            id="resume-instructions"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={instructionExamples}
            className="min-h-32"
            maxLength={20_000}
          />
          <p className="text-sm text-muted-foreground">Regenerating replaces unlocked bullets. Locked bullets stay.</p>
        </div>
        {save.isError && (
          <Alert variant="destructive">
            <AlertDescription>{save.error.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11" disabled={save.isPending} onClick={() => run(false)}>
            Save
          </Button>
          <Button className="h-11" disabled={save.isPending} onClick={() => run(true)}>
            Save &amp; regenerate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
