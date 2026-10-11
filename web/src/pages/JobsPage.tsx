import type { ApplicationSummary, TrackerStatus } from "@vita/shared";
import { AlarmClock, ArrowUpRight, BriefcaseBusiness, GraduationCap, LayoutGrid, List, Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { TrackerListView } from "@/api/client";
import { useApplications, useTrackerList } from "@/api/queries";
import { PageError, PageLoading } from "@/components/PageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { boardColumns, isDue, statusLabel } from "@/lib/tracker-view";

type Tracked = TrackerListView["applications"][number];
interface Row {
  app: ApplicationSummary;
  track?: Tracked;
}

const view = {
  get: () => {
    try {
      return localStorage.getItem("vita:jobs-view") === "list" ? "list" : "board";
    } catch {
      return "board";
    }
  },
  set: (value: string) => {
    try {
      localStorage.setItem("vita:jobs-view", value);
    } catch {
      /* Not remembered. */
    }
  },
};

function Flags({ track }: { track?: Tracked }) {
  if (!track) return null;
  const due = isDue(track.derived.nextFollowUpDue);
  return (
    <>
      {due && (
        <Badge className="gap-1">
          <AlarmClock className="size-3" aria-hidden="true" /> Follow-up due
        </Badge>
      )}
      {track.derived.stale && !["accepted", "rejected", "withdrawn", "ghosted"].includes(track.tracker.status) && (
        <Badge variant="outline">Quiet for {track.derived.daysSinceLastActivity} days</Badge>
      )}
    </>
  );
}

function JobCard({ row }: { row: Row }) {
  const status = row.track?.tracker.status;
  const id = encodeURIComponent(row.app.id);
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <Link
        to={`/jobs/${id}`}
        className="flex flex-col gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="font-display text-base font-medium break-words">{row.app.title}</span>
          <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        {row.app.company && <span className="text-sm text-muted-foreground break-words">{row.app.company}</span>}
      </Link>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={row.app.done ? "secondary" : "outline"}>
          {row.app.done ? "Ready to export" : "Needs review"}
        </Badge>
        {status && status !== "draft" && <Badge variant="secondary">{statusLabel[status]}</Badge>}
        <Flags track={row.track} />
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link to={`/jobs/${id}/timeline`} className="text-primary underline underline-offset-2">
          Timeline
        </Link>
        <Link
          to={`/jobs/${id}/prep`}
          className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
        >
          <GraduationCap className="size-3.5" aria-hidden="true" /> Interview prep
        </Link>
      </div>
    </li>
  );
}

export default function JobsPage() {
  const apps = useApplications();
  const tracker = useTrackerList();
  const [mode, setMode] = useState<"board" | "list">(view.get);
  if (apps.isPending) return <PageLoading />;
  if (apps.isError) return <PageError error={apps.error} retry={() => void apps.refetch()} />;
  const byId = new Map((tracker.data?.applications ?? []).map((entry) => [entry.id, entry]));
  const rows: Row[] = apps.data.map((app) => ({ app, track: byId.get(app.id) }));
  const open = (row: Row) =>
    !["accepted", "rejected", "withdrawn", "ghosted"].includes(row.track?.tracker.status ?? "draft");
  const attention = rows.filter(
    (row) => row.track && open(row) && (isDue(row.track.derived.nextFollowUpDue) || row.track.derived.stale),
  );
  const funnel = tracker.data?.funnel ?? {};
  const funnelItems = (Object.keys(statusLabel) as TrackerStatus[]).filter((status) => (funnel[status] ?? 0) > 0);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="font-display text-3xl font-bold">Jobs</h1>
          <p className="text-muted-foreground">A resume for each opportunity, and where each one stands.</p>
        </div>
        <Button asChild className="h-11">
          <Link to="/jobs/new">
            <Plus data-icon="inline-start" />
            New job
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
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
        <>
          <section aria-labelledby="attention" className="flex flex-col gap-3">
            <h2 id="attention" className="font-display text-xl font-medium">
              Needs your attention today
            </h2>
            {attention.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                All caught up. No follow-ups are due and nothing has gone quiet.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {attention.map((row) => (
                  <JobCard key={row.app.id} row={row} />
                ))}
              </ul>
            )}
          </section>
          {funnelItems.length > 0 && (
            <section aria-label="Funnel" className="flex flex-wrap gap-2">
              {funnelItems.map((status) => (
                <Badge key={status} variant="secondary" className="px-3 py-1 text-sm">
                  {statusLabel[status]} · {funnel[status]}
                </Badge>
              ))}
            </section>
          )}
          <section aria-labelledby="all-jobs" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="all-jobs" className="font-display text-xl font-medium">
                All jobs
              </h2>
              <fieldset className="flex gap-1 border-0 p-0" aria-label="How to show jobs">
                {(
                  [
                    ["board", "Board", LayoutGrid],
                    ["list", "List", List],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <Button
                    key={value}
                    variant={mode === value ? "secondary" : "ghost"}
                    className="h-11"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value);
                      view.set(value);
                    }}
                  >
                    <Icon /> {label}
                  </Button>
                ))}
              </fieldset>
            </div>
            {mode === "list" ? (
              <ul className="grid gap-3">
                {rows.map((row) => (
                  <JobCard key={row.app.id} row={row} />
                ))}
              </ul>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 xl:grid-cols-6 lg:overflow-visible">
                {boardColumns.map((column) => {
                  const cards = rows.filter((row) => column.statuses.includes(row.track?.tracker.status ?? "draft"));
                  return (
                    <section
                      key={column.title}
                      aria-label={column.title}
                      className="flex min-w-64 flex-1 flex-col gap-2 lg:min-w-0"
                    >
                      <h3 className="flex items-center justify-between text-sm font-medium text-muted-foreground">
                        {column.title}
                        <span>{cards.length}</span>
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {cards.map((row) => (
                          <JobCard key={row.app.id} row={row} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
