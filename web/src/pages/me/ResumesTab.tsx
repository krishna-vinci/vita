import type { JobView, ResumeSummary } from "@vita/shared";
import { Archive, ChevronDown, FileDown, Loader2, MoreHorizontal, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  useArchivedResumes,
  useArchiveResume,
  useDeleteResume,
  useGenerateMaster,
  useJobs,
  useResumes,
  useUnarchiveResume,
  useWorkspace,
} from "@/api/queries";
import { DeleteDialog } from "@/components/DeleteDialog";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { progressStep, progressSteps } from "@/lib/resume-view";
import { useUrlFlag } from "@/lib/use-url-state";
import { NewBaseDialog } from "./NewBaseDialog";
import { SyncBanner } from "./SyncBanner";

const busy = (job: JobView) => job.status === "queued" || job.status === "running";

export default function ResumesTab() {
  const resumes = useResumes();
  const jobs = useJobs();
  const workspace = useWorkspace();
  const generate = useGenerateMaster();
  if (resumes.isPending) return <PageLoading />;
  if (resumes.isError) return <PageError error={resumes.error} retry={() => void resumes.refetch()} />;
  const all = jobs.data ?? [];
  const master = resumes.data.find((resume) => resume.kind === "master");
  const bases = resumes.data.filter((resume) => resume.kind === "base");
  const known = new Set(resumes.data.map((resume) => resume.id));
  const making = all.filter((job) => busy(job) && job.kind === "base" && job.resourceId && !known.has(job.resourceId));
  const masterJob = all.find((job) => job.kind === "master" && busy(job));
  const failed = all.find(
    (job) =>
      job.status === "failed" && (job.kind === "master" || job.kind === "base") && !known.has(job.resourceId ?? ""),
  );
  const startMaster = () =>
    generate.mutate(undefined, {
      onError: (error) => toast.error(error.message),
    });
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-muted-foreground">
        Your master resume holds your best of everything. Base resumes lead with one kind of work, ready to start a job
        resume from.
      </p>
      <SyncBanner />
      {!workspace.data?.hasOutline && (
        <Alert>
          <AlertDescription>
            Start by writing your outline or importing an old resume. Then Vita can write your master resume.{" "}
            <Link to="/me/outline" className="underline underline-offset-2">
              Go to my outline
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>The last attempt didn't work: {failed.error ?? "something went wrong."}</AlertDescription>
        </Alert>
      )}
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <li>
          {master ? (
            <ResumeCard
              resume={master}
              label="Master"
              job={masterJob}
              onRegenerate={startMaster}
              regenerating={generate.isPending}
            />
          ) : (
            <Card className="h-full border-primary/40">
              <CardHeader>
                <Badge variant="secondary" className="w-fit">
                  Master
                </Badge>
                <CardTitle className="font-display text-lg">Everything, best version</CardTitle>
                <CardDescription>Your complete resume, built from your outline and evidence.</CardDescription>
              </CardHeader>
              <CardContent>{masterJob && <Making job={masterJob} />}</CardContent>
              <CardFooter>
                <Button
                  className="h-11"
                  onClick={startMaster}
                  disabled={!workspace.data?.hasOutline || !!masterJob || generate.isPending}
                >
                  Write my master resume
                </Button>
              </CardFooter>
            </Card>
          )}
        </li>
        {bases.map((resume) => (
          <li key={resume.id}>
            <ResumeCard
              resume={resume}
              label="Targeted"
              job={all.find((job) => busy(job) && job.resourceId === resume.id)}
            />
          </li>
        ))}
        {making.map((job) => (
          <li key={job.id}>
            <Card className="h-full">
              <CardHeader>
                <Badge variant="outline" className="w-fit">
                  Targeted
                </Badge>
                <CardTitle className="font-display text-lg break-words">{job.resourceId}</CardTitle>
              </CardHeader>
              <CardContent>
                <Making job={job} />
              </CardContent>
            </Card>
          </li>
        ))}
        <li>
          <NewBaseDialog disabled={!master} />
          {!master && <p className="mt-2 text-sm text-muted-foreground">Write your master resume first.</p>}
        </li>
      </ul>
      <ArchivedBases />
    </div>
  );
}

function ArchivedBases() {
  const archived = useArchivedResumes();
  const restore = useUnarchiveResume();
  const remove = useDeleteResume();
  // Open state is in the URL (?archived=1), so a reload or Back keeps it.
  const [open, setOpen] = useUrlFlag("archived");
  const [target, setTarget] = useState<ResumeSummary | null>(null);
  const list = archived.data?.filter((resume) => resume.kind === "base") ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-label="Archived base resumes" className="flex flex-col gap-3">
      <Button
        variant="ghost"
        className="h-11 w-fit px-2 text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown className={open ? "" : "-rotate-90"} /> Archived ({list.length})
      </Button>
      {open && (
        <ul className="flex flex-col gap-2">
          {list.map((resume) => (
            <li
              key={resume.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <span className="min-w-0 font-medium break-words">{resume.name}</span>
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(resume.id, {
                      onSuccess: () => toast.success(`Restored "${resume.name}".`),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <Undo2 /> Restore
                </Button>
                <Button variant="ghost" className="h-11 text-destructive" onClick={() => setTarget(resume)}>
                  <Trash2 /> Delete permanently
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <DeleteDialog
        open={!!target}
        onOpenChange={(next) => !next && setTarget(null)}
        name={`"${target?.name ?? ""}"`}
        onConfirm={async () => {
          if (!target) return;
          await remove.mutateAsync(target.id);
          toast.success(`Deleted "${target.name}".`);
        }}
      />
    </section>
  );
}

function Making({ job }: { job: JobView }) {
  const step = Math.max(progressStep(job.progress), 0);
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      {job.status === "queued" ? "Waiting for a turn…" : `${progressSteps[step]}…`}
    </p>
  );
}

function ArchiveMenu({ resume }: { resume: ResumeSummary }) {
  const archive = useArchiveResume();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-my-2.5 -mr-2 size-11 shrink-0"
          aria-label={`More for ${resume.name}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={archive.isPending}
          onSelect={() =>
            archive.mutate(resume.id, {
              onSuccess: () => toast.success(`Archived "${resume.name}". Find it under Archived.`),
              onError: (error) => toast.error(error.message),
            })
          }
        >
          <Archive /> Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ResumeCard({
  resume,
  label,
  job,
  onRegenerate,
  regenerating,
}: {
  resume: ResumeSummary;
  label: string;
  job?: JobView;
  onRegenerate?: () => void;
  regenerating?: boolean;
}) {
  return (
    <Card className={resume.kind === "master" ? "h-full border-primary/40" : "h-full"}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <Badge variant={resume.kind === "master" ? "secondary" : "outline"} className="w-fit">
            {label}
          </Badge>
          {resume.kind === "base" && <ArchiveMenu resume={resume} />}
        </div>
        <CardTitle className="font-display text-lg break-words">
          {resume.kind === "master" ? "Everything, best version" : resume.name}
        </CardTitle>
        <CardDescription>
          {job ? "Being rewritten now." : resume.done ? "Checked and ready." : "Needs a final check."}
        </CardDescription>
      </CardHeader>
      <CardContent>{job && <Making job={job} />}</CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button asChild className="h-11">
          <Link to={`/me/resumes/${encodeURIComponent(resume.id)}`}>Open</Link>
        </Button>
        {resume.pdfUrl && (
          <Button asChild variant="outline" className="h-11">
            <a href={resume.pdfUrl} target="_blank" rel="noreferrer">
              <FileDown /> PDF
            </a>
          </Button>
        )}
        {onRegenerate && (
          <Button variant="ghost" className="h-11" onClick={onRegenerate} disabled={!!job || regenerating}>
            <RefreshCw /> Rewrite
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
