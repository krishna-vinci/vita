import type { JobView, ResumeSummary } from "@vita/shared";
import { FileDown, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useGenerateMaster, useJobs, useResumes, useWorkspace } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { progressStep, progressSteps } from "@/lib/resume-view";
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
    </div>
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
        <Badge variant={resume.kind === "master" ? "secondary" : "outline"} className="w-fit">
          {label}
        </Badge>
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
