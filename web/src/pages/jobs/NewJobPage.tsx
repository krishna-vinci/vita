import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useCancelJob, useCreateApplication, useJob, useResumes, useWorkspace } from "@/api/queries";
import { instructionExamples } from "@/components/InstructionsDialog";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JobProgress } from "./JobProgress";

export default function NewJobPage() {
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job") ?? "";
  const workspace = useWorkspace();
  if (workspace.isPending) return <PageLoading />;
  if (workspace.isError) return <PageError error={workspace.error} retry={() => void workspace.refetch()} />;
  if (!workspace.data.hasOutline)
    return (
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyTitle>Start with your outline</EmptyTitle>
          <EmptyDescription>
            A job resume is built from what you've told Vita about your work. Start by writing your outline or importing
            an old resume.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild className="h-11">
            <Link to="/me/outline">Go to my outline</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  return <JobForm jobId={jobId} onJob={(id) => setParams(id ? { job: id } : {}, { replace: true })} />;
}

function JobForm({ jobId, onJob }: { jobId: string; onJob: (id: string) => void }) {
  const navigate = useNavigate();
  const [jobText, setJobText] = useState("");
  const [instructions, setInstructions] = useState("");
  const [baseId, setBaseId] = useState("auto");
  const bases = useResumes();
  const create = useCreateApplication();
  const cancel = useCancelJob();
  const job = useJob(jobId);
  const status = job.data?.status;
  const resultId = job.data?.result?.id;
  useEffect(() => {
    if (status === "done" && resultId) navigate(`/jobs/${encodeURIComponent(resultId)}`, { replace: true });
  }, [status, resultId, navigate]);

  if (jobId && job.data && (status === "queued" || status === "running" || status === "done"))
    return (
      <JobProgress
        job={job.data}
        title="Making your resume"
        onCancel={() => {
          cancel.mutate(jobId);
          onJob("");
        }}
      />
    );
  const failed = jobId && (status === "failed" || status === "cancelled");
  const submit = async () => {
    try {
      const made = await create.mutateAsync({
        jobText,
        instructions: instructions.trim() || undefined,
        baseId: baseId === "auto" ? undefined : baseId,
      });
      onJob(made.job.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start. Please try again.");
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold">A resume for your next job</h1>
        <p className="text-muted-foreground">
          Paste the job description. Vita picks your best-matching work and checks every line against your notes. If the
          job asks for something your notes don't show, it asks you a few questions first, then writes once.
        </p>
      </div>
      {failed && (
        <Alert variant="destructive">
          <AlertTitle>{status === "cancelled" ? "Stopped" : "That didn't work"}</AlertTitle>
          <AlertDescription>
            {status === "cancelled"
              ? "Nothing was saved. Your text is still here."
              : (job.data?.error ?? "Something went wrong while making your resume.")}
          </AlertDescription>
        </Alert>
      )}
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="job-text">Job description</Label>
          <Textarea
            id="job-text"
            value={jobText}
            onChange={(event) => setJobText(event.target.value)}
            placeholder="Paste the whole post here"
            className="min-h-64"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="job-instructions">Instructions for this resume</Label>
          <Textarea
            id="job-instructions"
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder={instructionExamples}
            className="min-h-24"
            maxLength={20_000}
          />
          <p className="text-sm text-muted-foreground">
            Optional. Tell Vita what to lead with, what to leave out, or how long it should be. You can change this
            later and rewrite.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="job-base">Start from</Label>
          <Select value={baseId} onValueChange={setBaseId}>
            <SelectTrigger id="job-base" className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">The closest match to this job</SelectItem>
              {bases.data?.map((base) => (
                <SelectItem key={base.id} value={base.id}>
                  {base.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">You can change this later and make a new version.</p>
        </div>
        <Button type="submit" className="h-12 w-fit px-6" disabled={!jobText.trim() || create.isPending}>
          {create.isPending ? "Starting…" : "Make my resume"}
        </Button>
      </form>
    </div>
  );
}
