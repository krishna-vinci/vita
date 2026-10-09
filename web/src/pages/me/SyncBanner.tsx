import type { SyncSuggestion } from "@vita/shared";
import { useState } from "react";
import { toast } from "sonner";
import { useApplySync, useResumes, useSyncSuggestions } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const key = (s: SyncSuggestion) => `${s.resumeId}|${s.kind}|${s.bulletId ?? ""}|${s.claimId}`;

/** "Your outline changed": a calm banner that opens a sheet of before/after lines to accept. */
export function SyncBanner({ resumeId }: { resumeId?: string }) {
  const query = useSyncSuggestions();
  const resumes = useResumes();
  const apply = useApplySync();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const all = (query.data ?? []).filter((item) => !resumeId || item.resumeId === resumeId);
  if (!all.length) return null;
  const isOn = (item: SyncSuggestion) => chosen[key(item)] ?? !item.locked;
  const toggle = (item: SyncSuggestion) => setChosen((all) => ({ ...all, [key(item)]: !isOn(item) }));
  const picks = all.filter(isOn);
  const name = (id: string) => resumes.data?.find((resume) => resume.id === id)?.name ?? id;
  const groups = [...new Set(all.map((item) => item.resumeId))];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-secondary p-4 text-secondary-foreground">
        <p className="min-w-0 flex-1 text-sm">
          <strong>Your outline changed.</strong> {all.length} {all.length === 1 ? "line can" : "lines can"} be updated.
        </p>
        <Button variant="outline" className="h-11 bg-background" onClick={() => setOpen(true)}>
          Review changes
        </Button>
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
                  {all
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
