import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApproveTemplate, useDiscardTemplate, useJobs, useProposeTemplate, useTemplateUpload } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { PageError, PageLoading } from "@/components/PageState";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function Pdf({ url, title }: { url: string | null; title: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {url ? (
        <>
          <iframe src={url} title={title} className="h-[480px] w-full rounded-md border bg-white" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-sm text-primary underline underline-offset-2"
          >
            Open in a new tab
          </a>
        </>
      ) : (
        <p className="rounded-md border p-4 text-sm text-muted-foreground">Not available yet.</p>
      )}
    </figure>
  );
}

/** Original PDF, then Vita's adapted version beside it. Nothing is installed until you approve. */
export function TemplateAdoption({ id, onClose }: { id: string; onClose: () => void }) {
  const upload = useTemplateUpload(id);
  const jobs = useJobs();
  const propose = useProposeTemplate();
  const approve = useApproveTemplate();
  const discard = useDiscardTemplate();
  const running = jobs.data?.find(
    (job) =>
      job.kind === "template-adoption" &&
      job.resourceId === id &&
      (job.status === "queued" || job.status === "running"),
  );
  const failed = jobs.data?.find(
    (job) => job.kind === "template-adoption" && job.resourceId === id && job.status === "failed",
  );
  if (upload.isPending) return <PageLoading />;
  if (upload.isError) return <PageError error={upload.error} retry={() => void upload.refetch()} />;
  const view = upload.data;
  const proposal = view.proposal;
  const start = () => propose.mutate(id, { onError: (error) => toast.error(error.message) });
  const drop = () => discard.mutate(id, { onSuccess: onClose, onError: (error) => toast.error(error.message) });
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-card p-4" aria-label="Adapting your template">
      <h3 className="font-display text-lg font-medium">{proposal ? "Compare and approve" : "Your template"}</h3>
      {failed && !running && !proposal && (
        <Alert variant="destructive">
          <AlertTitle>Adapting didn't work</AlertTitle>
          <AlertDescription>{failed.error ?? "Please try again."}</AlertDescription>
        </Alert>
      )}
      <div className={proposal ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
        <Pdf url={view.originalPdfUrl} title="Your original" />
        {proposal && <Pdf url={view.previewPdfUrl} title="Adapted for Vita" />}
      </div>
      {proposal && (
        <>
          {view.renderCheck && !view.renderCheck.ok && (
            <Alert variant="destructive">
              <AlertDescription>
                The adapted preview has layout problems. Look closely before approving.
              </AlertDescription>
            </Alert>
          )}
          {proposal.notes.length > 0 && (
            <div>
              <p className="font-medium">What changed</p>
              <ul className="list-disc pl-5 text-sm text-muted-foreground">
                {proposal.notes.map((note) => (
                  <li key={note} className="break-words">
                    <Markdown inline text={note} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {running && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Adapting your
          template. This can take a minute.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {proposal ? (
          <Button
            className="h-11"
            disabled={approve.isPending || !!running}
            onClick={() =>
              approve.mutate(
                { id, proposal },
                {
                  onSuccess: () => {
                    toast.success("Template added.");
                    onClose();
                  },
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          >
            Approve and add it
          </Button>
        ) : (
          <Button className="h-11" onClick={start} disabled={propose.isPending || !!running}>
            Adapt it for Vita
          </Button>
        )}
        {proposal && (
          <Button variant="outline" className="h-11" onClick={start} disabled={!!running}>
            Try again
          </Button>
        )}
        <Button variant="ghost" className="h-11" onClick={drop} disabled={discard.isPending || !!running}>
          Discard
        </Button>
      </div>
    </section>
  );
}
