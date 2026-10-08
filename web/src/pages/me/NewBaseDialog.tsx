import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateBase } from "@/api/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  const submit = async () => {
    setError("");
    try {
      await create.mutateAsync({ name: name.trim() });
      toast.success(`Writing "${name.trim()}" now.`);
      setOpen(false);
      setName("");
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
