import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "@/api/client";
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

interface UsedBy {
  id: string;
  title: string;
}

/** The jobs listed in a `base-in-use` error, if that is the failure. */
export function usedBy(error: unknown): UsedBy[] {
  if (!(error instanceof ApiError) || error.code !== "base-in-use") return [];
  const list = (error.details as { applications?: unknown } | undefined)?.applications;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (entry): entry is UsedBy =>
      !!entry && typeof (entry as UsedBy).id === "string" && typeof (entry as UsedBy).title === "string",
  );
}

/** A destructive confirmation. Stays open on failure and shows why. */
export function DeleteDialog({
  open,
  onOpenChange,
  name,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** What goes with it. */
  children?: ReactNode;
  onConfirm: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const jobs = usedBy(error);
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
          <AlertDialogTitle>Delete {name} permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            It is removed from Vita. It stays in your workspace's git history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {jobs.length > 0 ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>Job resumes still start from this one. Delete or change those first:</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {jobs.map((job) => (
                  <li key={job.id} className="break-words">
                    <Link to={`/jobs/${encodeURIComponent(job.id)}`} className="underline underline-offset-2">
                      {job.title}
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
            disabled={pending || jobs.length > 0}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
                onOpenChange(false);
              } catch (failure) {
                setError(failure);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
