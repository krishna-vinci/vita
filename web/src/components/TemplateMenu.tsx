import type { TemplateSummary } from "@vita/shared";
import { Copy, Eye, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useDiscardTemplate, useForkTemplate } from "@/api/queries";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const studioPath = (id: string) => `/settings/templates/${encodeURIComponent(id)}`;

/** Asks for a name, copies the template into your workspace, then opens the studio on the copy. */
export function ForkDialog({
  template,
  open,
  onOpenChange,
}: {
  template: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const fork = useForkTemplate();
  const [name, setName] = useState(`${template.name} (mine)`);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    fork.mutate(
      { id: template.id, name: name.trim() },
      {
        onSuccess: (copy) => {
          onOpenChange(false);
          toast.success("Your copy is ready to edit.");
          navigate(studioPath(copy.id));
        },
        onError: (failure) => setError(failure.message),
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Make my own copy</DialogTitle>
            <DialogDescription>
              {template.name} stays as it is. Your copy is yours to change, and it appears next to the others.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-copy-name">Name for your copy</Label>
            <Input
              id="template-copy-name"
              value={name}
              maxLength={200}
              className="h-11"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-11" disabled={fork.isPending || !name.trim()}>
              {fork.isPending ? "Copying…" : "Make my copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The resumes a `template-in-use` error lists, as links. */
function usedResumes(error: unknown): { path: string; to: string }[] {
  if (!(error instanceof ApiError) || error.code !== "template-in-use") return [];
  const list = (error.details as { resumes?: unknown } | undefined)?.resumes;
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry): entry is string => typeof entry === "string")
    .map((path) => {
      const [kind, id = ""] = path.split("/");
      return {
        path,
        to: kind === "applications" ? `/jobs/${encodeURIComponent(id)}` : `/me/resumes/${encodeURIComponent(id)}`,
      };
    });
}

export function DeleteTemplateDialog({
  template,
  open,
  onOpenChange,
  onDeleted,
}: {
  template: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const discard = useDiscardTemplate();
  const [error, setError] = useState<unknown>(null);
  const using = usedResumes(error);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {template.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your copy is removed. It stays in your workspace's git history. Built-in templates are not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {using.length > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>These resumes still use it. Change their template first:</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {using.map((entry) => (
                  <li key={entry.path} className="break-words">
                    <Link to={entry.to} className="underline underline-offset-2">
                      {entry.path.replace(/^(resumes|applications)\//, "")}
                    </Link>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error instanceof Error ? error.message : "Could not delete."}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" className="h-11">
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className="h-11"
            disabled={discard.isPending || using.length > 0}
            onClick={() => {
              setError(null);
              discard.mutate(template.id, {
                onSuccess: () => {
                  onOpenChange(false);
                  toast.success(`Deleted ${template.name}.`);
                  onDeleted?.();
                },
                onError: setError,
              });
            }}
          >
            {discard.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The `⋯` menu on a gallery card. Built-in templates can be copied or read; your own can be edited or deleted. */
export function TemplateMenu({ template }: { template: TemplateSummary }) {
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"fork" | "delete" | null>(null);
  const name = template.meta.name;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="-my-2 -mr-2 ml-auto size-11 shrink-0"
            aria-label={`More for ${name}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {template.bundled ? (
            <DropdownMenuItem onSelect={() => navigate(studioPath(template.id))}>
              <Eye /> View source
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => navigate(studioPath(template.id))}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("fork")}>
            <Copy /> Make my own copy
          </DropdownMenuItem>
          {!template.bundled && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "fork" && (
        <ForkDialog template={{ id: template.id, name }} open onOpenChange={(open) => !open && setDialog(null)} />
      )}
      {dialog === "delete" && (
        <DeleteTemplateDialog
          template={{ id: template.id, name }}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}
    </>
  );
}
