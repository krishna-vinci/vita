import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateBase, usePacks } from "@/api/queries";
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

export function NewBaseDialog({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const create = useCreateBase();
  const packs = usePacks();
  const [chosen, setChosen] = useState<string[]>([]);
  const submit = async () => {
    setError("");
    try {
      await create.mutateAsync({ name: name.trim(), ...(chosen.length ? { packs: chosen } : {}) });
      toast.success(`Writing "${name.trim()}" now.`);
      setOpen(false);
      setName("");
      setChosen([]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start. Please try again.");
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-full min-h-40 w-full flex-col gap-1 border-dashed" disabled={disabled}>
          <span className="flex items-center gap-2 font-medium">
            <Plus /> New base resume
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
            <DialogTitle>New base resume</DialogTitle>
            <DialogDescription>
              A base resume leads with one kind of work. You can start job resumes from it later.
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
