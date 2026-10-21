import type { ApplicationSummary, ResumeSummary } from "@vita/shared";
import { Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const MASTER_CHOICE = "__master__";

/** The PDF as the template renders it, with a choice of which resume to show. */
export function StudioPreview({
  url,
  proposed,
  loading,
  error,
  stale,
  resumeId,
  onResumeId,
  resumes,
  applications,
  onRefresh,
}: {
  url: string | null;
  /** The shown PDF is a proposed design that has not been applied. */
  proposed: boolean;
  loading: boolean;
  error: string | null;
  /** There are unsaved edits, so the PDF shows the last saved version. */
  stale: boolean;
  resumeId: string;
  onResumeId: (id: string) => void;
  resumes: ResumeSummary[];
  applications: ApplicationSummary[];
  onRefresh: () => void;
}) {
  const bases = resumes.filter((resume) => resume.kind === "base" && resume.pdfUrl);
  const jobs = applications.filter((job) => job.pdfUrl);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor="preview-with" className="text-xs text-muted-foreground">
            Preview with
          </Label>
          <Select value={resumeId} onValueChange={onResumeId}>
            <SelectTrigger id="preview-with" className="w-full" aria-label="Preview with">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MASTER_CHOICE}>Master resume</SelectItem>
              {bases.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Base resumes</SelectLabel>
                  {bases.map((resume) => (
                    <SelectItem key={resume.id} value={resume.id}>
                      {resume.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {jobs.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Jobs</SelectLabel>
                  {jobs.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.company ? `${job.title} · ${job.company}` : job.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" className="h-11" disabled={loading} onClick={onRefresh}>
          <RefreshCw className={loading ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden="true" />{" "}
          Refresh
        </Button>
      </div>
      {proposed && <p className="text-xs text-primary">Showing the proposed design. It is not saved yet.</p>}
      {stale && !proposed && (
        <p className="text-xs text-muted-foreground">You have unsaved edits. This shows the last saved version.</p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>The preview didn't compile</AlertTitle>
          <AlertDescription>
            <pre className="max-h-40 w-full overflow-auto font-mono text-xs whitespace-pre-wrap">{error}</pre>
          </AlertDescription>
        </Alert>
      )}
      <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-md border bg-white">
        {url ? (
          <iframe src={url} title="Template preview" className="size-full min-h-[420px] bg-white" />
        ) : (
          <p className="p-4 text-sm text-neutral-600">{loading ? "Making the preview…" : "No preview yet."}</p>
        )}
        {loading && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center gap-2 bg-background/70 text-sm text-foreground"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Making the
            preview…
          </div>
        )}
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="w-fit text-sm text-primary underline underline-offset-2"
        >
          Open in a new tab
        </a>
      )}
    </div>
  );
}
