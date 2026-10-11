import type { Prep, PrepQuestion } from "@vita/shared";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { useApplication, useJobs, usePrep, useStartPrep } from "@/api/queries";
import { Markdown } from "@/components/Markdown";
import { PageError, PageLoading } from "@/components/PageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDetails } from "@/lib/use-details";
import { JobTabs } from "../workspace/JobTabs";

const groups: { kind: PrepQuestion["kind"]; title: string }[] = [
  { kind: "technical", title: "Technical questions" },
  { kind: "behavioral", title: "Tell me about a time…" },
  { kind: "system-design", title: "Design questions" },
  { kind: "gap", title: "Things the job asks that you haven't done" },
  { kind: "company", title: "About the company" },
];

export default function PrepPage() {
  const { id = "" } = useParams();
  const prep = usePrep(id);
  const app = useApplication(id);
  const jobs = useJobs();
  const start = useStartPrep(id);
  const [details, setDetails] = useDetails();
  const running = jobs.data?.find(
    (job) => job.kind === "prep" && job.resourceId === id && (job.status === "queued" || job.status === "running"),
  );
  const failed = jobs.data?.find((job) => job.kind === "prep" && job.resourceId === id && job.status === "failed");
  const make = () => start.mutate(undefined, { onError: (error) => toast.error(error.message) });
  const title = app.data
    ? [app.data.analysis.title, app.data.analysis.company].filter(Boolean).join(" at ")
    : "this job";
  const missing = prep.error instanceof ApiError && prep.error.status === 404;
  return (
    <div className="flex flex-col gap-6">
      <Button variant="link" className="h-11 w-fit px-0" asChild>
        <Link to={`/jobs/${encodeURIComponent(id)}`}>
          <ArrowLeft /> Back to my resume
        </Link>
      </Button>
      <JobTabs id={id} current="prep" />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-bold">Get ready for {title}</h1>
          <p className="max-w-2xl text-muted-foreground">
            Likely questions, stories from your own work, and honest answers for what you haven't done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="prep-details" checked={details} onCheckedChange={setDetails} />
          <Label htmlFor="prep-details" className="cursor-pointer text-muted-foreground">
            Show details
          </Label>
        </div>
      </header>
      {running ? (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Writing your interview prep. This usually takes a minute or two.
        </p>
      ) : prep.isPending ? (
        <PageLoading />
      ) : missing ? (
        <div className="flex max-w-xl flex-col gap-3 rounded-xl border bg-card p-6">
          <h2 className="font-display text-xl font-medium">No prep yet</h2>
          <p className="text-muted-foreground">
            Vita will draft questions and talking points from your resume and evidence. It never adds experience you
            don't have.
          </p>
          {failed && (
            <p className="text-sm text-destructive">
              The last try didn't work: {failed.error ?? "something went wrong."}
            </p>
          )}
          <Button className="h-11 w-fit" onClick={make} disabled={start.isPending}>
            Start my interview prep
          </Button>
        </div>
      ) : prep.isError ? (
        <PageError error={prep.error} retry={() => void prep.refetch()} />
      ) : (
        <>
          <PrepBody prep={prep.data} requirements={app.data?.analysis.requirements ?? []} details={details} />
          <Button variant="outline" className="h-11 w-fit" onClick={make} disabled={start.isPending}>
            <RefreshCw /> Write it again
          </Button>
        </>
      )}
    </div>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 text-sm">
      {items.map((item) => (
        <li key={item} className="break-words">
          <Markdown inline text={item} />
        </li>
      ))}
    </ul>
  );
}

function PrepBody({
  prep,
  requirements,
  details,
}: {
  prep: Prep;
  requirements: { id: string; text: string }[];
  details: boolean;
}) {
  return (
    <div className="flex flex-col gap-10">
      {groups.map(({ kind, title }) => {
        const questions = prep.questions.filter((question) => question.kind === kind);
        if (!questions.length) return null;
        return (
          <section key={kind} aria-label={title} className="flex flex-col gap-3">
            <h2 className="font-display text-xl font-medium">{title}</h2>
            <ul className="grid gap-3 lg:grid-cols-2">
              {questions.map((question) => (
                <li key={question.id}>
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="font-display text-base font-medium break-words">
                        {question.question}
                      </CardTitle>
                      <Markdown text={question.why} className="text-sm text-muted-foreground" />
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <Points items={question.talkingPoints} />
                      {details && question.claimIds.length > 0 && (
                        <p className="font-mono text-xs text-muted-foreground">
                          Based on: {question.claimIds.join(", ")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {prep.stories.length > 0 && (
        <section aria-label="Your stories" className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium">Stories from your work</h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {prep.stories.map((story) => (
              <li key={story.id}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="font-display text-base font-medium break-words">
                      <Markdown inline text={story.title} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p>
                      <strong>The situation. </strong>
                      <Markdown inline text={story.situation} />
                    </p>
                    <p>
                      <strong>Your job. </strong>
                      <Markdown inline text={story.task} />
                    </p>
                    <p>
                      <strong>What you did. </strong>
                      <Markdown inline text={story.action} />
                    </p>
                    {story.result ? (
                      <p>
                        <strong>The result. </strong>
                        <Markdown inline text={story.result} />
                      </p>
                    ) : (
                      <p className="rounded-md border border-dashed p-2 text-muted-foreground">
                        <strong>Add the result.</strong> What changed because of what you did? Say it in your own words,
                        with a real number only if you have one.
                      </p>
                    )}
                    {details && story.claimIds.length > 0 && (
                      <p className="font-mono text-xs text-muted-foreground">Based on: {story.claimIds.join(", ")}</p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {prep.gaps.length > 0 && (
        <section aria-label="Gaps" className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-medium">If they ask about something you haven't done</h2>
          <ul className="grid gap-3 lg:grid-cols-2">
            {prep.gaps.map((gap) => (
              <li key={gap.requirementId}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="font-display text-base font-medium break-words">
                      {requirements.find((requirement) => requirement.id === gap.requirementId)?.text ??
                        gap.requirementId}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <p>
                      <strong>The honest answer. </strong>
                      <Markdown inline text={gap.honestAnswer} />
                    </p>
                    <p>
                      <strong>What you can bridge from. </strong>
                      <Markdown inline text={gap.bridge} />
                    </p>
                    <p>
                      <strong>Your plan. </strong>
                      <Markdown inline text={gap.plan} />
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
