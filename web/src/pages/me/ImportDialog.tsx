import type { ImportLegacyResult } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useImportProjects } from "@/api/queries";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Paste old notes as text, preview what would be added, then apply. Nothing is saved before the preview. */
export function ImportDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ImportLegacyResult | null>(null);
  const importer = useImportProjects();
  const reset = () => {
    setText("");
    setPreview(null);
  };
  const run = async (apply: boolean) => {
    try {
      const baseHash = apply ? (await api.projects.get()).hash : undefined;
      const result = await importer.mutateAsync({ markdown: text, apply, ...(apply ? { baseHash } : {}) });
      if (apply) {
        toast.success("Imported. Your projects are updated.");
        setOpen(false);
        reset();
      } else setPreview(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import that.");
    }
  };
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
          <DialogTitle>Import an old resume or project notes</DialogTitle>
          <DialogDescription>
            Paste it as text. You'll see what will be added before anything is saved.
          </DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="flex flex-col gap-3">
            <p className="font-medium">This will become your projects:</p>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs break-words whitespace-pre-wrap">
              {preview.markdown}
            </pre>
            {preview.report.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {preview.report.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-text">Paste here</Label>
            <Textarea
              id="import-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-56"
            />
          </div>
        )}
        <DialogFooter>
          {preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button disabled={importer.isPending} onClick={() => void run(true)}>
                Import
              </Button>
            </>
          ) : (
            <Button disabled={!text.trim() || importer.isPending} onClick={() => void run(false)}>
              Show me what will be added
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
