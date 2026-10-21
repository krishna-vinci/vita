import type { TexHunk, TexView } from "@vita/shared";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useResumeTex, useSaveResumeTex } from "@/api/queries";
import { DiffView } from "@/components/DiffView";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { errorMessages, texLinesOf } from "@/lib/template-errors";
import { cn } from "@/lib/utils";

const TexEditor = lazy(() => import("@/components/TexEditor"));

type Scope = "resume" | "application";
type Problem = { kind: "invalid" | "conflict" | "error"; messages: string[]; lines: number[]; honesty: boolean };

export const HONESTY_COPY = "Add bullets in the resume editor so they are checked; LaTeX edits are for layout.";

const hunkDiff = (hunk: TexHunk) =>
  `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`;

/** What went wrong with a save, in words an owner can act on, plus the lines to mark. */
function problemOf(error: unknown): Problem {
  if (error instanceof ApiError && error.status === 409)
    return { kind: "conflict", messages: [error.message], lines: [], honesty: false };
  if (error instanceof ApiError && error.status === 422) {
    const check = (error.details ?? {}) as {
      unexpectedItems?: string[];
      missingBullets?: string[];
      outOfOrder?: string[];
      pages?: number;
      maxPages?: number;
    };
    const messages: string[] = [];
    for (const item of check.unexpectedItems ?? []) messages.push(`New item that is not in the resume: ${item}`);
    for (const bullet of check.missingBullets ?? []) messages.push(`A bullet went missing from the PDF: ${bullet}`);
    if (check.outOfOrder?.length) messages.push("Some bullets are now out of order in the PDF.");
    if (check.pages && check.maxPages && check.pages > check.maxPages)
      messages.push(`The PDF is ${check.pages} pages; the limit is ${check.maxPages}.`);
    const honesty = !!check.unexpectedItems?.length || /unexpected/i.test(error.message);
    if (!messages.length) messages.push(...errorMessages(error.message));
    return { kind: "invalid", messages, lines: texLinesOf(error.message), honesty };
  }
  return {
    kind: "error",
    messages: [error instanceof Error ? error.message : "Could not save."],
    lines: [],
    honesty: false,
  };
}

function Body({ scope, id, initial, onClose }: { scope: Scope; id: string; initial: TexView; onClose: () => void }) {
  const { save, reset } = useSaveResumeTex(scope, id);
  const [base, setBase] = useState<TexView>(initial);
  const [draft, setDraft] = useState(initial.patched);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tab, setTab] = useState<"code" | "changes">(initial.conflict ? "changes" : "code");
  const [panel, setPanel] = useState(!!initial.conflict);
  const [confirmReset, setConfirmReset] = useState(false);
  const problemPanel = useRef<HTMLDivElement>(null);
  const dirty = draft !== base.patched;
  const busy = save.isPending || reset.isPending;

  useEffect(() => {
    // The editor scrolls to the error line in its own frame; wait for that, then show the panel.
    if (!problem) return;
    const timer = setTimeout(() => problemPanel.current?.scrollIntoView?.({ block: "nearest" }), 150);
    return () => clearTimeout(timer);
  }, [problem]);

  const adopt = (view: TexView, keepDraft = false) => {
    setBase(view);
    if (!keepDraft || draft !== view.patched) setDraft(view.patched);
    setProblem(null);
  };
  const doSave = async (hash = base.hash) => {
    if (busy) return;
    setProblem(null);
    try {
      adopt(await save.mutateAsync({ tex: draft, baseHash: hash }), true);
      toast.success("LaTeX saved.");
    } catch (error) {
      setProblem(problemOf(error));
    }
  };
  const reload = async () => {
    try {
      adopt(await api.tex.get(scope, id));
    } catch (error) {
      setProblem(problemOf(error));
    }
  };
  const keepMine = async () => {
    try {
      await doSave((await api.tex.get(scope, id)).hash);
    } catch (error) {
      setProblem(problemOf(error));
    }
  };
  const doReset = async () => {
    setConfirmReset(false);
    try {
      adopt(await reset.mutateAsync());
      toast.success("Back to the generated LaTeX.");
    } catch (error) {
      setProblem(problemOf(error));
    }
  };
  const showPanel = panel || !!base.conflict;
  return (
    <>
      <div
        role="tablist"
        aria-label="LaTeX sections"
        className="mx-4 mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 lg:hidden"
      >
        {(["code", "changes"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={cn(
              "h-11 rounded-md text-sm font-medium capitalize",
              tab === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
            onClick={() => setTab(entry)}
          >
            {entry}
          </button>
        ))}
      </div>
      <div className={cn("grid min-h-0 flex-1 gap-4 p-4", showPanel && "lg:grid-cols-[minmax(0,1fr)_440px]")}>
        <section
          aria-label="LaTeX source"
          className={cn("min-h-0 min-w-0 flex-col gap-2 lg:flex", tab === "code" ? "flex" : "hidden")}
        >
          <div className="min-h-[320px] flex-1">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TexEditor
                value={draft}
                onChange={setDraft}
                errorLines={problem?.kind === "invalid" ? problem.lines : []}
                onSave={() => void doSave()}
                ariaLabel="LaTeX of this resume"
                height="100%"
              />
            </Suspense>
          </div>
          <div ref={problemPanel} className="flex scroll-mb-40 flex-col gap-2 empty:hidden">
            {problem?.kind === "conflict" && (
              <Alert variant="destructive">
                <AlertTitle>This LaTeX changed elsewhere</AlertTitle>
                <AlertDescription>
                  <p>A newer version was saved. Load it, or keep what you have and overwrite it.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" className="h-11" onClick={() => void reload()}>
                      Reload
                    </Button>
                    <Button variant="outline" className="h-11" onClick={() => void keepMine()}>
                      Keep mine
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {problem && problem.kind !== "conflict" && (
              <Alert variant="destructive" className="max-h-52 overflow-auto">
                <AlertTitle>{problem.kind === "invalid" ? "This couldn't be saved" : "Saving didn't work"}</AlertTitle>
                <AlertDescription>
                  <p>Your text is still in the editor. Nothing was changed.</p>
                  {problem.honesty && <p className="font-medium">{HONESTY_COPY}</p>}
                  <ul aria-label="Problems" className="mt-1 flex w-full flex-col gap-0.5 font-mono text-xs">
                    {problem.messages.map((line, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: message lines repeat and have no identity.
                      <li key={index} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        </section>
        <aside
          aria-label="Changes"
          className={cn(
            "min-h-0 min-w-0 flex-col gap-3 overflow-y-auto lg:rounded-lg lg:border lg:bg-muted/30 lg:p-3",
            tab === "changes" ? "flex" : "hidden",
            showPanel ? "lg:flex" : "lg:hidden",
          )}
        >
          {base.conflict && (
            <section aria-label="Edits that did not fit" className="flex flex-col gap-2">
              <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                Some of your LaTeX edits didn't fit the regenerated resume. Re-apply these by hand in the editor, then
                save.
              </p>
              {base.conflict.failedHunks.map((hunk, index) => (
                <div key={hunkDiff(hunk)} className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Part {index + 1} of {base.conflict?.failedHunks.length}
                  </p>
                  <DiffView diff={hunkDiff(hunk)} label={`Edit that did not apply, part ${index + 1}`} />
                </div>
              ))}
            </section>
          )}
          <section aria-label="Your saved edits" className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Your edits to the generated LaTeX</h3>
            {dirty ? (
              <p className="text-sm text-warning">Unsaved changes. Save to see them as a patch.</p>
            ) : base.patch ? (
              <DiffView diff={base.patch} label="Your saved LaTeX edits" />
            ) : (
              <p className="text-sm text-muted-foreground">No edits yet. This resume uses the generated LaTeX.</p>
            )}
          </section>
        </aside>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t bg-card px-4 py-3">
        <p
          role="status"
          className={cn("w-full text-sm lg:mr-auto lg:w-auto", dirty ? "text-warning" : "text-muted-foreground")}
        >
          {save.isPending
            ? "Saving…"
            : dirty
              ? "Unsaved changes"
              : "Your edits are kept and reapplied after every regenerate."}
        </p>
        <div className="hidden items-center gap-2 lg:flex">
          <Switch id="show-changes" checked={showPanel} disabled={!!base.conflict} onCheckedChange={setPanel} />
          <Label htmlFor="show-changes" className="cursor-pointer text-muted-foreground">
            Show changes
          </Label>
        </div>
        <Button
          variant="ghost"
          className="h-11"
          disabled={busy || (!base.patch && !base.conflict)}
          onClick={() => setConfirmReset(true)}
        >
          Reset to generated
        </Button>
        <Button variant="outline" className="h-11" onClick={onClose}>
          Close
        </Button>
        <Button className="h-11" disabled={busy || !dirty} onClick={() => void doSave()} title="Ctrl+S">
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to the generated LaTeX?</AlertDialogTitle>
            <AlertDialogDescription>
              Your LaTeX edits are dropped and the PDF is made from the generated LaTeX again. Your resume's content is
              not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" className="h-11">
                Keep my edits
              </Button>
            </AlertDialogCancel>
            <Button variant="destructive" className="h-11" onClick={() => void doReset()}>
              Reset
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Final touches to one resume's generated LaTeX. Edits are stored as a patch and reapplied on every regenerate. */
export function TexEditDialog({
  open,
  onOpenChange,
  scope,
  id,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: Scope;
  id: string;
}) {
  const tex = useResumeTex(scope, id, open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="h-dvh w-screen max-w-none gap-0 p-0 sm:max-w-none">
        <SheetHeader className="border-b p-4">
          <SheetTitle>Edit LaTeX</SheetTitle>
          <SheetDescription>
            Layout touches such as spacing, a custom line or an icon. Resume text is edited in the resume itself.
          </SheetDescription>
        </SheetHeader>
        {tex.isPending ? (
          <div className="p-4">
            <PageLoading />
          </div>
        ) : tex.isError ? (
          <div className="p-4">
            <PageError error={tex.error} retry={() => void tex.refetch()} />
          </div>
        ) : (
          <Body scope={scope} id={id} initial={tex.data} onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
