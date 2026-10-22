import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateBase, usePacks } from "@/api/queries";
import { useFactsGate } from "@/components/FactsGate";
import { instructionExamples } from "@/components/InstructionsDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDraft } from "@/lib/use-draft";

export function NewBaseDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  // Unsent text is kept for this tab until the base is made.
  const [name, setName, clearName] = useDraft("new-base:name");
  const [instructions, setInstructions, clearInstructions] = useDraft("new-base:instructions");
  const [error, setError] = useState("");
  const create = useCreateBase();
  const packs = usePacks();
  const facts = useFactsGate();
  const [chosenText, setChosenText, clearChosen] = useDraft("new-base:packs");
  const chosen = chosenText ? chosenText.split(",") : [];
  const setChosen = (next: (all: string[]) => string[]) => setChosenText(next(chosen).join(","));
  const submit = () => facts.run(start);
  const start = async () => {
    setError("");
    try {
      await create.mutateAsync({
        name: name.trim(),
        ...(chosen.length ? { packs: chosen } : {}),
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
      toast.success(`Writing "${name.trim()}" now.`);
      setOpen(false);
      clearName();
      clearInstructions();
      clearChosen();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start. Please try again.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {facts.dialog}
      <DialogTrigger asChild>
        <Button variant="outline" className="h-full min-h-40 w-full flex-col gap-1 border-dashed" disabled={disabled}>
          <span className="flex items-center gap-2 font-medium">
            <Plus /> New version
          </span>
          <span className="max-w-56 text-wrap text-sm font-normal text-muted-foreground">
            Name a direction, like "AI backend". Vita drafts it from your master.
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New version</DialogTitle>
            <DialogDescription>
              A version leads with one kind of work. You can start job resumes from it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="base-name">What direction is it for?</Label>
            <Input
              id="base-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. AI backend"
              autoFocus
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="base-instructions">Instructions for this version (optional)</Label>
            <Textarea
              id="base-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={instructionExamples}
              className="min-h-20"
              maxLength={20_000}
            />
          </div>
          {packs.data && packs.data.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Profession presets (optional)</legend>
              <p className="text-sm text-muted-foreground">Presets add the usual keywords and questions for a field.</p>
              <div className="grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2">
                {packs.data
                  .filter((pack) => pack.id !== "general")
                  .map((pack) => (
                    <label
                      key={pack.id}
                      htmlFor={`pack-${pack.id}`}
                      className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        id={`pack-${pack.id}`}
                        checked={chosen.includes(pack.id)}
                        onCheckedChange={(on) =>
                          setChosen((all) => (on ? [...all, pack.id] : all.filter((id) => id !== pack.id)))
                        }
                      />
                      {pack.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Starting…" : "Write it"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
