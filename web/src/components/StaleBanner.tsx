import type { SyncStaleResume } from "@vita/shared";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useApplications, useCascade, useResumes, useSyncStatus } from "@/api/queries";
import { Button } from "@/components/ui/button";

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * "Resumes are out of date": one button re-runs every stale resume through the server, which orders the jobs.
 * With `resumeId`, it shows only that resume's entry.
 */
export function StaleBanner({ resumeId }: { resumeId?: string }) {
  const status = useSyncStatus();
  const resumes = useResumes();
  const applications = useApplications();
  const cascade = useCascade();
  const [open, setOpen] = useState(false);
  const all = (status.data?.stale ?? []).filter((item) => !resumeId || item.id === resumeId);
  const reason = all[0]?.reason;
  if (!reason) return null;
  const name = (item: SyncStaleResume) =>
    resumes.data?.find((resume) => resume.id === item.id)?.name ??
    applications.data?.find((app) => app.id === item.id)?.title ??
    item.id;
  const update = () =>
    cascade.mutate(undefined, {
      onSuccess: (result) => {
        const count = result.jobIds.length;
        toast.success(`Updating ${count} ${plural(count, "resume", "resumes")}…`);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409)
          toast.error("Vita is busy. Try again when the current job finishes.");
        else toast.error(error instanceof Error ? error.message : "Could not update your resumes.");
      },
    });
  const count = all.length;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-secondary p-4 text-secondary-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm break-words">
          {resumeId ? (
            <>
              <strong>This resume is out of date</strong> ({reason})
            </>
          ) : (
            <>
              <strong>
                {count} {plural(count, "resume is", "resumes are")} out of date:
              </strong>{" "}
              {reason}
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!resumeId && (
            <Button variant="link" className="h-11 px-0" aria-expanded={open} onClick={() => setOpen(!open)}>
              <ChevronDown className={open ? "" : "-rotate-90"} /> Details
            </Button>
          )}
          <Button variant="outline" className="h-11 bg-background" onClick={update} disabled={cascade.isPending}>
            <RefreshCw /> {resumeId ? "Update" : "Update all"}
          </Button>
        </div>
      </div>
      {open && !resumeId && (
        <ul className="flex flex-col gap-1 pl-1 text-sm">
          {all.map((item) => (
            <li key={item.id} className="break-words">
              <span className="font-medium">{name(item)}</span>: {item.reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
