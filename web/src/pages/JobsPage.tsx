import { ArrowUpRight, BriefcaseBusiness, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useApplications } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function JobsPage() {
  const query = useApplications();
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-bold">Jobs</h1>
          <p className="text-muted-foreground">A resume for each opportunity.</p>
        </div>
        <Button asChild className="h-11">
          <Link to="/jobs/new">
            <Plus data-icon="inline-start" />
            New job
          </Link>
        </Button>
      </div>
      {query.isPending ? (
        <PageLoading />
      ) : query.isError ? (
        <PageError error={query.error} retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BriefcaseBusiness />
            </EmptyMedia>
            <EmptyTitle>Your next opportunity starts here</EmptyTitle>
            <EmptyDescription>
              Resumes made for jobs will appear here. Start with a job description when you're ready.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" asChild className="h-11">
              <Link to="/jobs/new">Start a job resume</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {query.data.map((application) => (
            <li key={application.id}>
              <Link
                to={`/jobs/${encodeURIComponent(application.id)}`}
                className="flex min-h-24 items-center justify-between gap-4 rounded-lg p-5 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="font-display text-lg font-medium break-words">{application.title}</h2>
                  {application.company && (
                    <p className="text-sm text-muted-foreground break-words">{application.company}</p>
                  )}
                  <Badge variant={application.done ? "secondary" : "outline"} className="mt-1 w-fit">
                    {application.done ? "Ready to export" : "Needs review"}
                  </Badge>
                </div>
                <ArrowUpRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
