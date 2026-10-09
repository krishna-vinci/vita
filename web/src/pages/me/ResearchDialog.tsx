import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCancelJob, useJob, useStartResearch } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { ProposalReview } from "@/components/ProposalDiff";
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

/** Look something up (a repo, a site or a project name) and review what Vita would add. */
export function ResearchDialog({
  trigger,
  initial,
  title = "Add from GitHub or a link",
}: {
  trigger: React.ReactNode;
  initial?: { target: string; itemSlug: string };
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(initial?.target ?? "");
  const [jobId, setJobId] = useState("");
  const start = useStartResearch();
  const cancel = useCancelJob();
  const job = useJob(jobId);
  const status = job.data?.status;
  const running = !!jobId && (!status || status === "queued" || status === "running");
  const reset = () => {
    setJobId("");
    if (!initial) setTarget("");
  };
  const submit = async () => {
    try {
      const made = await start.mutateAsync({
        target: target.trim(),
        ...(initial ? { itemSlug: initial.itemSlug } : {}),
      });
      setJobId(made.job.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start.");
    }
  };
  const result = status === "done" ? job.data?.result : undefined;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Paste a repository or website link, or a project name. Vita reads it and proposes what to add. You decide.
          </DialogDescription>
        </DialogHeader>
        {!jobId ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="research-target">Link or name</Label>
              <Input
                id="research-target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="https://github.com/you/project"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!target.trim() || start.isPending}>
                {start.isPending ? "Starting…" : "Look it up"}
              </Button>
            </DialogFooter>
          </form>
        ) : running ? (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Reading it now. This can take a minute.
            </p>
            <Button
              variant="outline"
              className="w-fit"
              onClick={() => {
                cancel.mutate(jobId);
                reset();
              }}
            >
              Cancel
            </Button>
          </div>
        ) : status === "done" ? (
          <div className="flex flex-col gap-3">
            {result?.reply && <Markdown text={result.reply} className="text-sm" />}
            {result?.proposal ? (
              <ProposalReview proposal={result.proposal} onDone={(accepted) => accepted && setOpen(false)} />
            ) : (
              <p className="text-sm text-muted-foreground">Nothing new to add.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-destructive">
              {job.data?.error ?? (status === "cancelled" ? "Stopped." : "That didn't work.")}
            </p>
            <Button variant="outline" className="w-fit" onClick={() => setJobId("")}>
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
