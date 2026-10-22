import type { SyncSuggestion } from "@vita/shared";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import {
  useApplications,
  useApplySync,
  useCascade,
  useResumes,
  useSyncStatus,
  useSyncSuggestions,
} from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const key = (s: SyncSuggestion) => `${s.resumeId}|${s.kind}|${s.bulletId ?? ""}|${s.claimId}`;

/**
 * One banner for everything an outline edit left behind.
 * Stale resumes get one Update (the cascade re-runs them in order). Line suggestions open a review sheet.
 * Hidden when neither has anything. With `resumeId`, it shows only that resume, as a workspace banner.
 * `showLines={false}` leaves out line suggestions (job resumes have none to review).
 */
export function ChangesBanner({ resumeId, showLines = true }: { resumeId?: string; showLines?: boolean }) {
  const status = useSyncStatus();
  const suggestions = useSyncSuggestions();
  const resumes = useResumes();
  const applications = useApplications();
  const cascade = useCascade();
  const apply = useApplySync();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const stale = (status.data?.stale ?? []).filter((item) => !resumeId || item.id === resumeId);
  const lines = showLines ? (suggestions.data ?? []).filter((item) => !resumeId || item.resumeId === resumeId) : [];
  if (!stale.length && !lines.length) return null;

  const reason = stale[0]?.reason;
  const count = stale.length;
  const update = () =>
    cascade.mutate(undefined, {
      onSuccess: (result) => {
        const jobs = result.jobIds.length;
        toast.success(`Updating ${jobs} ${plural(jobs, "resume", "resumes")}…`);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409)
          toast.error("Vita is busy. Try again when the current job finishes.");
        else toast.error(error instanceof Error ? error.message : "Could not update your resumes.");
      },
    });

  const isOn = (item: SyncSuggestion) => chosen[key(item)] ?? !item.locked;
  const toggle = (item: SyncSuggestion) => setChosen((all) => ({ ...all, [key(item)]: !isOn(item) }));
  const picks = lines.filter(isOn);
  const name = (id: string) =>
    resumes.data?.find((resume) => resume.id === id)?.name ??
    applications.data?.find((app) => app.id === id)?.title ??
    id;
  const groups = [...new Set(lines.map((item) => item.resumeId))];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-secondary p-4 text-secondary-foreground">
        <p className="min-w-0 flex-1 text-sm break-words">
          {resumeId && count > 0 ? (
            <>
              <strong>This resume is out of date</strong>
              {reason && <> ({reason})</>}
            </>
          ) : (
            <strong>Your information changed.</strong>
          )}
          {!resumeId && count > 0 && (
            <>
              {" "}
              {count} {plural(count, "resume is", "resumes are")} out of date.
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {lines.length > 0 && (
            <Button variant="link" className="h-11 px-0" onClick={() => setOpen(true)}>
              Review line changes ({lines.length})
            </Button>
          )}
          {count > 0 && (
            <Button className="h-11" onClick={update} disabled={cascade.isPending}>
              <RefreshCw /> {resumeId ? "Update" : "Update resumes"}
            </Button>
          )}
        </div>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-display">Updates from your outline</SheetTitle>
            <SheetDescription>
              Pick the changes to bring into your resumes. Nothing changes until you apply.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4">
            {groups.map((id) => (
              <section key={id} className="flex flex-col gap-2" aria-label={name(id)}>
                <h3 className="font-medium">{name(id)}</h3>
                <ul className="flex flex-col gap-2">
                  {lines
                    .filter((item) => item.resumeId === id)
                    .map((item) => (
                      <li key={key(item)} className="flex gap-3 rounded-lg border p-3 text-sm">
                        <Checkbox
                          id={key(item)}
                          checked={isOn(item)}
                          onCheckedChange={() => toggle(item)}
                          className="mt-1"
                        />
                        <label htmlFor={key(item)} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1">
                          {item.kind === "add" && (
                            <span className="text-xs font-medium text-muted-foreground">New line</span>
                          )}
                          {item.kind === "remove" && (
                            <span className="text-xs font-medium text-muted-foreground">Remove this line</span>
                          )}
                          {item.before && (
                            <span className="break-words text-muted-foreground line-through">{item.before}</span>
                          )}
                          {item.after && <span className="break-words">{item.after}</span>}
                          {item.locked && (
                            <span className="text-xs text-warning">
                              You edited this line, so it stays as it is unless you tick it.
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          <SheetFooter>
            <Button
              className="h-11"
              disabled={!picks.length || apply.isPending}
              onClick={() =>
                apply.mutate(
                  { picks },
                  {
                    onSuccess: () => {
                      toast.success("Updated.");
                      setOpen(false);
                    },
                    onError: (error) => toast.error(error.message),
                  },
                )
              }
            >
              {apply.isPending ? "Applying…" : `Apply ${picks.length} ${picks.length === 1 ? "change" : "changes"}`}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
