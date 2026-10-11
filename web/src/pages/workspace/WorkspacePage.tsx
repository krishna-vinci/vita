import type { ApiResumeOp, ApplicationResource, ResumeResource } from "@vita/shared";
import { ArrowLeft, GraduationCap, MessageSquareText } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  useApplication,
  useApplicationAnswers,
  useApplicationOps,
  useCancelJob,
  useCreateApplication,
  useExportApplication,
  useFit,
  useJobs,
  useOutline,
  useProjects,
  usePromote,
  useResume,
  useResumeOps,
  useResumes,
  useUndo,
} from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { download, flagsFor, parseClaims, resumeToMarkdown } from "@/lib/resume-view";
import { JobProgress } from "../jobs/JobProgress";
import { SyncBanner } from "../me/SyncBanner";
import { ChangeTemplateDialog } from "./ChangeTemplateDialog";
import { ChatPanel } from "./ChatPanel";
import { DetailsPanel } from "./DetailsPanel";
import { FitDialog, type FitState } from "./FitDialog";
import { JobTabs } from "./JobTabs";
import { parseGaps, Questions } from "./Questions";
import { ResumeSheet } from "./ResumeSheet";
import { Toolbar } from "./Toolbar";
import type { SheetActions } from "./types";
import { useChatThread } from "./useChatThread";

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* The preference just won't be remembered. */
    }
  },
};

/** The job resume (scope "application") or a base resume (scope "resume"). */
export default function WorkspacePage({ scope }: { scope: "application" | "resume" }) {
  const { id = "" } = useParams();
  const isJob = scope === "application";
  const jobQuery = useApplication(isJob ? id : "");
  const baseQuery = useResume(isJob ? "" : id);
  const query = isJob ? jobQuery : baseQuery;
  const jobs = useJobs();
  const active = jobs.data?.find(
    (job) => job.resourceId === id && (job.status === "queued" || job.status === "running"),
  );
  const cancel = useCancelJob();
  const back = isJob ? { to: "/jobs", label: "All jobs" } : { to: "/me/resumes", label: "Base resumes" };
  if (active)
    return (
      <div className="flex flex-col gap-4">
        <BackLink {...back} />
        <JobProgress
          job={active}
          title={isJob ? "Updating your resume" : "Writing your resume"}
          onCancel={() => cancel.mutate(active.id)}
        />
      </div>
    );
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  return <Loaded key={`${scope}:${id}`} scope={scope} id={id} data={query.data} back={back} />;
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Button variant="link" className="h-11 w-fit px-0" asChild>
      <Link to={to}>
        <ArrowLeft /> {label}
      </Link>
    </Button>
  );
}

function Loaded({
  scope,
  id,
  data,
  back,
}: {
  scope: "application" | "resume";
  id: string;
  data: ApplicationResource | ResumeResource;
  back: { to: string; label: string };
}) {
  const isJob = scope === "application";
  const app = isJob ? (data as ApplicationResource) : undefined;
  const navigate = useNavigate();
  const [details, setDetails] = useState(() => store.get("vita:details") === "1");
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  // Skipped questions are remembered for this tab only. Answers live on the server (`app.answers`).
  const skipKey = `vita:skipped:${id}`;
  const [skipped, setSkipped] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(skipKey) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const rememberSkipped = (ids: string[]) => {
    setSkipped(ids);
    try {
      sessionStorage.setItem(skipKey, JSON.stringify(ids));
    } catch {
      /* Fine: they will be offered again. */
    }
  };
  const appOps = useApplicationOps(isJob ? id : "");
  const baseOps = useResumeOps(isJob ? "" : id);
  const ops = isJob ? appOps : baseOps;
  const answers = useApplicationAnswers(id);
  const exporter = useExportApplication(id);
  const undo = useUndo();
  const create = useCreateApplication();
  const bases = useResumes();
  const jobs = useJobs();
  const outline = useOutline();
  const projects = useProjects();
  const thread = useChatThread(scope, id, data.resume);
  const fitter = useFit(scope, id);
  const promoter = usePromote();
  const [fit, setFit] = useState<FitState | null>(null);
  const [templates, setTemplates] = useState(false);
  const startFit = async (pages: number) => {
    setFit({ pages, loading: true });
    try {
      setFit({ pages, loading: false, ops: await fitter.mutateAsync(pages) });
    } catch (error) {
      setFit({ pages, loading: false, error: error instanceof Error ? error.message : "Could not try that." });
    }
  };

  const flags = useMemo(() => flagsFor(data.resume, data.review), [data.resume, data.review]);
  const claims = useMemo(
    () => parseClaims(outline.data?.markdown ?? "", projects.data?.markdown ?? ""),
    [outline.data, projects.data],
  );
  const checks = useMemo(
    () => new Map((data.review?.checks ?? []).map((note) => [note.bulletId, note])),
    [data.review],
  );

  const run = async (list: ApiResumeOp[]): Promise<boolean> => {
    try {
      const result = await ops.mutateAsync({ ops: list });
      setChanged(new Set(result.changedBullets));
      thread.clearChanged();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That change didn't work.");
      return false;
    }
  };
  const ask = (message: string) => {
    if (!matchMedia("(min-width: 1024px)").matches) setChatOpen(true);
    void thread.send(message);
  };
  const actions: SheetActions = {
    edit: (bulletId, text) => run([{ op: "bullet.edit", id: bulletId, text }]),
    hide: (bulletId, hidden) => void run([{ op: "bullet.hide", id: bulletId, hidden }]),
    hideSection: (sectionId, hidden) => void run([{ op: "section.hide", id: sectionId, hidden }]),
    hideItem: (itemId, hidden) => void run([{ op: "item.hide", id: itemId, hidden }]),
    move: (bulletId, toParent, index) => run([{ op: "move", id: bulletId, toParent, index }]),
    vouch: (bulletId, note) => void run([{ op: "bullet.override", id: bulletId, reason: "user-attested", note }]),
    ask,
    promote: isJob
      ? (bulletId, to, itemSlug) =>
          promoter.mutate(
            {
              from: { scope, id, bulletId },
              to: to === "parent" ? { kind: "parent" } : { kind: "variant", itemSlug },
            },
            {
              onSuccess: () => toast.success(to === "parent" ? "Added to your base resume." : "Saved in Projects."),
              onError: (error) => toast.error(error.message),
            },
          )
      : undefined,
  };

  // A failed update stays visible until a later one succeeds, so a quiet failure never looks like a loop.
  const mine = (jobs.data ?? [])
    .filter((job) => job.resourceId === id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const failure = mine[0]?.status === "failed" ? mine[0] : undefined;
  const failureNote = failure ? (
    <Alert variant="destructive">
      <AlertTitle>The last update didn't work</AlertTitle>
      <AlertDescription>{failure.error ?? "Something went wrong. Please try again."}</AlertDescription>
    </Alert>
  ) : null;
  const answered = app?.answers ?? {};
  const unanswered = parseGaps(app?.gaps ?? []).filter((gap) => !(gap.id in answered));
  const gaps = unanswered.filter((gap) => !skipped.includes(gap.id));
  if (isJob && gaps.length)
    return (
      <div className="flex flex-col gap-4">
        <BackLink {...back} />
        {failureNote}
        <Questions
          gaps={gaps}
          pending={answers.isPending}
          onSkipAll={() => rememberSkipped([...skipped, ...gaps.map((gap) => gap.id)])}
          onSubmit={async (given) => {
            if (!Object.keys(given).length) return rememberSkipped([...skipped, ...gaps.map((gap) => gap.id)]);
            try {
              await answers.mutateAsync({ answers: given });
              // Anything left unanswered stays skipped for now, so only new questions come back.
              rememberSkipped([...skipped, ...gaps.filter((gap) => !(gap.id in given)).map((gap) => gap.id)]);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Your answers could not be sent.");
            }
          }}
        />
      </div>
    );

  const pdfUrl = data.pdfUrl;
  const title = app ? [app.analysis.title, app.analysis.company].filter(Boolean).join(" at ") : data.resume.header.name;
  const parent = bases.data?.find((base) => base.id === data.resume.parent);
  const issues = flags.size;
  const saveUrl = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = "resume.pdf";
    link.click();
  };
  const onPdf = async () => {
    if (!isJob) return pdfUrl && saveUrl(pdfUrl);
    try {
      const result = await exporter.mutateAsync();
      saveUrl(result.pdfUrl);
      toast.success("Your PDF is ready.", {
        action: { label: "Prepare for the interview", onClick: () => navigate(`/jobs/${encodeURIComponent(id)}/prep`) },
        duration: 10_000,
      });
    } catch (error) {
      toast.error(
        issues
          ? "A few lines still need your decision. Look for the highlighted lines."
          : error instanceof Error
            ? error.message
            : "The PDF could not be made.",
        { description: details && error instanceof Error ? error.message : undefined },
      );
    }
  };
  const chat = (
    <ChatPanel
      messages={thread.messages}
      pending={thread.pending}
      onSend={(message) => void thread.send(message)}
      intro="Here's your resume. Ask me for any change, or click a line to edit it yourself."
      suggestions={["Put the strongest work first", "Make the summary shorter"]}
      className="h-full"
    />
  );
  return (
    <div className="flex flex-col gap-6">
      <BackLink {...back} />
      {failureNote}
      {isJob && <JobTabs id={id} current="resume" />}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold break-words">{title}</h1>
          <Badge variant={issues ? "outline" : "secondary"}>
            {issues
              ? `${issues} ${issues === 1 ? "line needs" : "lines need"} your decision`
              : data.review?.done
                ? "Ready to download"
                : "Checked again when you download"}
          </Badge>
        </div>
        {isJob && (
          <div>
            <Button asChild variant="outline" className="h-11">
              <Link to={`/jobs/${encodeURIComponent(id)}/prep`}>
                <GraduationCap /> Prepare for the interview
              </Link>
            </Button>
          </div>
        )}
        {isJob && (
          <p className="text-muted-foreground">
            Started from {parent ? parent.name : "your master resume"}
            {bases.data?.length ? (
              <>
                {" · "}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="link" className="h-auto p-0">
                      change
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {bases.data.map((base) => (
                      <DropdownMenuItem
                        key={base.id}
                        disabled={create.isPending}
                        onSelect={async () => {
                          try {
                            const made = await create.mutateAsync({
                              jobText: app?.jobText ?? "",
                              baseId: base.id,
                              notes: app?.notes,
                            });
                            navigate(`/jobs/new?job=${encodeURIComponent(made.job.id)}`);
                          } catch (error) {
                            toast.error(error instanceof Error ? error.message : "Could not start again.");
                          }
                        }}
                      >
                        Make a new version from {base.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </p>
        )}
      </header>
      {!isJob && <SyncBanner resumeId={id} />}
      <Toolbar
        details={details}
        onDetails={(on) => {
          setDetails(on);
          store.set("vita:details", on ? "1" : "0");
        }}
        undoing={undo.isPending}
        onUndo={() =>
          undo.mutate(
            { scope, id },
            {
              onSuccess: (result) => {
                setChanged(new Set());
                if (result.sha) toast.success("Undid the last change.");
                else toast.info("Nothing left to undo. This is the first version.");
              },
              onError: (error) => toast.error(error.message),
            },
          )
        }
        onPdf={() => void onPdf()}
        onMarkdown={() => download(`${id}.md`, "text/markdown", resumeToMarkdown(data.resume))}
        exporting={exporter.isPending}
        canPdf={isJob || !!pdfUrl}
        overBy={
          data.review?.render?.maxPages && data.review.render.pages > data.review.render.maxPages
            ? data.review.render.maxPages
            : undefined
        }
        onFit={(pages) => void startFit(pages)}
        onTemplate={() => setTemplates(true)}
      />
      {details && (
        <DetailsPanel
          resume={data.resume}
          analysis={app?.analysis}
          gaps={app?.gaps ?? []}
          review={data.review}
          jobs={(jobs.data ?? []).filter((job) => job.result?.id === id)}
          jobText={app?.jobText}
          skipped={unanswered.filter((gap) => skipped.includes(gap.id)).length}
          onAnswerSkipped={() => rememberSkipped([])}
          answers={answered}
          applicationId={isJob ? id : undefined}
        />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ResumeSheet
          resume={data.resume}
          flags={flags}
          ctx={{
            actions,
            details,
            busy: ops.isPending,
            canPromoteParent: !!data.resume.parent,
            changed: new Set([...changed, ...thread.changed]),
            claims,
            checks,
          }}
        />
        <aside className="sticky top-6 hidden h-[calc(100dvh-6rem)] rounded-xl border bg-card p-4 lg:flex lg:flex-col">
          {chat}
        </aside>
      </div>
      <Button
        className="fixed right-4 bottom-20 z-30 h-12 rounded-full shadow-lg lg:hidden"
        onClick={() => setChatOpen(true)}
      >
        <MessageSquareText /> Ask for a change
      </Button>
      <ChangeTemplateDialog open={templates} onOpenChange={setTemplates} />
      <FitDialog
        state={fit}
        resume={data.resume}
        applying={ops.isPending}
        onClose={() => setFit(null)}
        onApply={async (list) => {
          if (await run(list)) {
            toast.success("Done. Undo is one click away.");
            setFit(null);
          }
        }}
      />
      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="bottom" className="h-[80dvh] gap-2 p-4">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Chat</SheetTitle>
            <SheetDescription className="sr-only">Ask for changes to your resume.</SheetDescription>
          </SheetHeader>
          {chat}
        </SheetContent>
      </Sheet>
    </div>
  );
}
