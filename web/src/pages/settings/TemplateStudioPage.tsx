import { useQueryClient } from "@tanstack/react-query";
import type { TemplateDesignResult } from "@vita/shared";
import { ArrowLeft, Copy, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import {
  queryKeys,
  useApplications,
  useDesignTemplate,
  usePreviewTemplate,
  useResumes,
  useSaveTemplateSource,
  useTemplateSource,
  useTemplates,
} from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { DeleteTemplateDialog, ForkDialog } from "@/components/TemplateMenu";
import type { TexEditorHandle } from "@/components/TexEditor";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorLinesOf, errorMessages } from "@/lib/template-errors";
import { cn } from "@/lib/utils";
import { StudioDesign } from "./StudioDesign";
import { MASTER_CHOICE, StudioPreview } from "./StudioPreview";
import { StudioReference } from "./StudioReference";

// CodeMirror is large; it loads only when the studio opens.
const TexEditor = lazy(() => import("@/components/TexEditor"));

type Tab = "code" | "preview" | "reference" | "design";
type Problem = { kind: "invalid" | "conflict" | "error"; message: string };
const tabs: { id: Tab; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "preview", label: "Preview" },
  { id: "reference", label: "Reference" },
  { id: "design", label: "Design" },
];

function Studio({ id }: { id: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const source = useTemplateSource(id);
  const templates = useTemplates();
  const resumes = useResumes();
  const applications = useApplications();
  const saveMutation = useSaveTemplateSource(id);
  const previewMutation = usePreviewTemplate(id);
  const designMutation = useDesignTemplate(id);
  const editor = useRef<TexEditorHandle>(null);
  const problemPanel = useRef<HTMLDivElement>(null);

  const [base, setBase] = useState<{ source: string; hash: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tab, setTabState] = useState<Tab>("code");
  const [leftTab, setLeftTab] = useState<"reference" | "design">("reference");
  const [leftOpen, setLeftOpen] = useState(true);
  const [resumeChoice, setResumeChoice] = useState(MASTER_CHOICE);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [design, setDesign] = useState<TemplateDesignResult | null>(null);
  const [designError, setDesignError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dialog, setDialog] = useState<"fork" | "delete" | null>(null);

  const data = source.data;
  useEffect(() => {
    if (data && !base) {
      setBase({ source: data.source, hash: data.hash });
      setDraft(data.source);
    }
  }, [data, base]);

  const editable = !!data?.editable;
  const dirty = !!base && draft !== base.source;
  const saving = saveMutation.isPending;

  const setTab = (next: Tab) => {
    setTabState(next);
    if (next === "reference" || next === "design") setLeftTab(next);
  };

  const runPreview = useCallback(
    (choice: string) => {
      setPreviewError(null);
      previewMutation.mutate(choice === MASTER_CHOICE ? undefined : choice, {
        onSuccess: (result) => setPreviewUrl(result.previewUrl),
        onError: (error) => setPreviewError(error.message),
      });
    },
    [previewMutation],
  );
  useEffect(() => {
    // On a phone the panel sits below the editor, out of sight, so bring it up.
    // The editor scrolls to the error line in its own frame; wait for that, then show the panel.
    if (!problem) return;
    const timer = setTimeout(() => problemPanel.current?.scrollIntoView?.({ block: "nearest" }), 150);
    return () => clearTimeout(timer);
  }, [problem]);
  const previewed = useRef(false);
  useEffect(() => {
    if (base && !previewed.current) {
      previewed.current = true;
      runPreview(MASTER_CHOICE);
    }
  }, [base, runPreview]);

  // Unsaved text is lost on reload or close, so ask first.
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const adopt = (saved: { source: string; hash: string }, keepDraft = false) => {
    setBase({ source: saved.source, hash: saved.hash });
    if (!keepDraft || draft !== saved.source) setDraft(saved.source);
    if (data) client.setQueryData(queryKeys.templateSource(id), { ...data, source: saved.source, hash: saved.hash });
  };
  const failure = (error: unknown): Problem => {
    if (error instanceof ApiError && error.status === 409) return { kind: "conflict", message: error.message };
    if (error instanceof ApiError && error.status === 422) return { kind: "invalid", message: error.message };
    return { kind: "error", message: error instanceof Error ? error.message : "Could not save." };
  };
  const save = async (hash = base?.hash) => {
    if (!base || !hash || !editable || saving || (!dirty && hash === base.hash)) return;
    setProblem(null);
    try {
      const saved = await saveMutation.mutateAsync({ source: draft, baseHash: hash });
      adopt(saved, true);
      toast.success("Saved");
      runPreview(resumeChoice);
    } catch (error) {
      setProblem(failure(error));
    }
  };
  const reload = async () => {
    try {
      const fresh = await api.templates.source(id);
      adopt(fresh);
      setProblem(null);
      runPreview(resumeChoice);
    } catch (error) {
      setProblem(failure(error));
    }
  };
  const keepMine = async () => {
    try {
      const fresh = await api.templates.source(id);
      await save(fresh.hash);
    } catch (error) {
      setProblem(failure(error));
    }
  };
  const apply = async () => {
    if (!design) return;
    setApplying(true);
    setApplyError(null);
    try {
      const saved = await saveMutation.mutateAsync({ source: design.source, baseHash: design.baseHash });
      adopt(saved);
      setDesign(null);
      toast.success("Design applied.");
      runPreview(resumeChoice);
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "Could not apply the design.");
    } finally {
      setApplying(false);
    }
  };

  if (source.isPending || (data && !base)) return <PageLoading />;
  if (source.isError) return <PageError error={source.error} retry={() => void source.refetch()} />;
  if (!data || !base) return <PageLoading />;

  const name = data.meta.name;
  const parent = data.meta.forkedFrom
    ? (templates.data?.find((template) => template.id === data.meta.forkedFrom)?.meta.name ?? data.meta.forkedFrom)
    : null;
  const errorLines = problem?.kind === "invalid" ? errorLinesOf(problem.message) : [];
  const status = saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved";
  const insert = (code: string) => {
    editor.current?.insert(code);
    setTab("code");
  };
  const proposed = !!design && !!design.previewUrl;
  const showing = design?.previewUrl ?? previewUrl;

  return (
    <div className="flex flex-col gap-4 pb-20 lg:relative lg:left-1/2 lg:w-[min(96vw,1680px)] lg:-translate-x-1/2 lg:pb-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="ghost" className="-ml-3 h-11">
          <Link to="/settings">
            <ArrowLeft aria-hidden="true" /> Templates
          </Link>
        </Button>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="font-display text-xl font-medium break-words">{name}</h1>
          <Badge variant="outline">{editable ? "Yours" : "Built in"}</Badge>
          {parent && <p className="text-sm text-muted-foreground">Copy of {parent}</p>}
        </div>
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-30 flex items-center justify-end gap-2 border-t bg-card px-4 py-2 lg:static lg:z-auto lg:ml-auto lg:border-0 lg:bg-transparent lg:p-0">
          {editable ? (
            <>
              <p
                role="status"
                className={cn("mr-auto text-sm lg:mr-0", dirty ? "text-warning" : "text-muted-foreground")}
              >
                {status}
              </p>
              <Button
                variant="ghost"
                className="h-11"
                disabled={!dirty || saving}
                onClick={() => setConfirmDiscard(true)}
              >
                Discard changes
              </Button>
              <Button className="h-11" disabled={!dirty || saving} onClick={() => void save()} title="Ctrl+S">
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                variant="ghost"
                className="hidden h-11 text-destructive lg:inline-flex"
                onClick={() => setDialog("delete")}
              >
                Delete
              </Button>
            </>
          ) : (
            <Button className="h-11" onClick={() => setDialog("fork")}>
              <Copy aria-hidden="true" /> Make my own copy
            </Button>
          )}
        </div>
      </header>

      {!editable && (
        <Alert>
          <AlertTitle>Built-in templates can't be edited</AlertTitle>
          <AlertDescription>
            <p>You can read the source and preview it. Make your own copy to change it.</p>
          </AlertDescription>
        </Alert>
      )}

      <div
        role="tablist"
        aria-label="Studio sections"
        className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 lg:hidden"
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={cn(
              "h-11 rounded-md text-sm font-medium",
              tab === entry.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        className={cn(
          "grid gap-4 lg:h-[calc(100dvh-260px)] lg:min-h-[560px]",
          leftOpen
            ? "lg:grid-cols-[360px_minmax(0,1fr)_minmax(340px,0.85fr)]"
            : "lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]",
        )}
      >
        <aside
          aria-label="Reference and design"
          className={cn(
            "min-h-0 min-w-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2 lg:flex",
            tab === "reference" || tab === "design" ? "flex" : "hidden",
            !leftOpen && "lg:hidden",
          )}
        >
          <div role="tablist" aria-label="Side panel" className="hidden gap-1 lg:flex">
            {(["reference", "design"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={leftTab === entry}
                className={cn(
                  "h-9 flex-1 rounded-md text-sm font-medium capitalize",
                  leftTab === entry ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
                onClick={() => setLeftTab(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          {leftTab === "reference" ? (
            <StudioReference onInsert={insert} canInsert={editable} />
          ) : editable ? (
            <StudioDesign
              disabledReason={dirty ? "Save first. The designer works on the saved template." : null}
              pending={designMutation.isPending}
              error={designError}
              result={design}
              applying={applying}
              applyError={applyError}
              canApply={!dirty}
              onSend={(message) => {
                setApplyError(null);
                setDesignError(null);
                designMutation.mutate(message, {
                  onSuccess: (result) => setDesign(result),
                  onError: (error) => setDesignError(error.message),
                });
              }}
              onApply={() => void apply()}
              onDiscard={() => {
                setDesign(null);
                setApplyError(null);
              }}
            />
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              Make your own copy to ask the designer for changes. Built-in templates stay as they are.
            </p>
          )}
        </aside>

        <section
          aria-label="Template source"
          className={cn("min-h-0 min-w-0 flex-col gap-2 lg:flex", tab === "code" ? "flex" : "hidden")}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-muted-foreground">main.tex.njk</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden h-9 lg:inline-flex"
              onClick={() => setLeftOpen((open) => !open)}
            >
              {leftOpen ? <PanelLeftClose aria-hidden="true" /> : <PanelLeftOpen aria-hidden="true" />}
              {leftOpen ? "Hide reference" : "Show reference"}
            </Button>
          </div>
          <div className="h-[60dvh] min-h-[320px] lg:h-auto lg:min-h-0 lg:flex-1">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <TexEditor
                ref={editor}
                value={draft}
                onChange={setDraft}
                readOnly={!editable}
                errorLines={errorLines}
                onSave={() => void save()}
                ariaLabel={`LaTeX source of ${name}`}
                height="100%"
              />
            </Suspense>
          </div>
          <div ref={problemPanel} className="scroll-mb-40 flex flex-col gap-2 empty:hidden">
            {problem?.kind === "conflict" && (
              <Alert variant="destructive">
                <AlertTitle>This template changed elsewhere</AlertTitle>
                <AlertDescription>
                  <p>Someone saved a newer version. Load it, or keep what you have and overwrite theirs.</p>
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
              <Alert variant="destructive" className="max-h-48 overflow-auto">
                <AlertTitle>{problem.kind === "invalid" ? "This couldn't be saved" : "Saving didn't work"}</AlertTitle>
                <AlertDescription>
                  <p>Your text is still in the editor. Nothing was changed.</p>
                  <ul aria-label="Problems" className="mt-1 flex w-full flex-col gap-0.5 font-mono text-xs">
                    {errorMessages(problem.message).map((line, index) => (
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

        <section
          aria-label="Preview"
          className={cn("min-h-0 min-w-0 flex-col lg:flex", tab === "preview" ? "flex" : "hidden")}
        >
          <StudioPreview
            url={showing}
            proposed={proposed}
            loading={previewMutation.isPending}
            error={previewError}
            stale={dirty}
            resumeId={resumeChoice}
            onResumeId={(choice) => {
              setResumeChoice(choice);
              runPreview(choice);
            }}
            resumes={resumes.data ?? []}
            applications={applications.data ?? []}
            onRefresh={() => runPreview(resumeChoice)}
          />
        </section>
      </div>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The editor goes back to the last saved version. Your unsaved edits are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" className="h-11">
                Keep editing
              </Button>
            </AlertDialogCancel>
            <Button
              className="h-11"
              onClick={() => {
                setDraft(base.source);
                setProblem(null);
                setConfirmDiscard(false);
              }}
            >
              Discard changes
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog === "fork" && (
        <ForkDialog template={{ id, name }} open onOpenChange={(open) => !open && setDialog(null)} />
      )}
      {dialog === "delete" && (
        <DeleteTemplateDialog
          template={{ id, name }}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          onDeleted={() => navigate("/settings")}
        />
      )}
    </div>
  );
}

/** Settings → Templates → one template: source, preview, reference and design chat. */
export default function TemplateStudioPage() {
  const { id = "" } = useParams();
  return <Studio key={id} id={id} />;
}
