import type { ApplicationSummary, TrackerStatus } from "@vita/shared";
import {
  AlarmClock,
  Archive,
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronDown,
  GraduationCap,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { TrackerListView } from "@/api/client";
import {
  useApplications,
  useArchiveApplication,
  useArchivedApplications,
  useDeleteApplication,
  useTrackerList,
  useUnarchiveApplication,
} from "@/api/queries";
import { DeleteDialog } from "@/components/DeleteDialog";
import { PageError, PageLoading } from "@/components/PageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function JobMenu({ app }: { app: ApplicationSummary }) {
  const archive = useArchiveApplication();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="-mt-2 -mr-2 size-11 shrink-0"
          aria-label={`More for ${app.title}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={archive.isPending}
          onSelect={() =>
            archive.mutate(app.id, {
              onSuccess: () => toast.success(`Archived "${app.title}". Find it under Archived.`),
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

function ArchivedJobs() {
  const archived = useArchivedApplications();
  const restore = useUnarchiveApplication();
  const remove = useDeleteApplication();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ApplicationSummary | null>(null);
  const list = archived.data ?? [];
  if (list.length === 0) return null;
  return (
    <section aria-label="Archived jobs" className="flex flex-col gap-3">
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
          {list.map((app) => (
            <li
              key={app.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium break-words">{app.title}</span>
                {app.company && <span className="text-sm text-muted-foreground break-words">{app.company}</span>}
              </span>
              <span className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(app.id, {
                      onSuccess: () => toast.success(`Restored "${app.title}".`),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <Undo2 /> Restore
                </Button>
                <Button variant="ghost" className="h-11 text-destructive" onClick={() => setTarget(app)}>
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
        name={`"${target?.title ?? ""}"`}
        onConfirm={async () => {
          if (!target) return;
          await remove.mutateAsync(target.id);
          toast.success(`Deleted "${target.title}".`);
        }}
      >
        <div className="text-sm">
          <p>This removes everything for this job:</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            <li>the resume</li>
            <li>the cover letter</li>
            <li>interview prep</li>
            <li>the tracker card</li>
          </ul>
        </div>
      </DeleteDialog>
    </section>
  );
}

function JobCard({ row }: { row: Row }) {
  const status = row.track?.tracker.status;
  const id = encodeURIComponent(row.app.id);
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/jobs/${id}`}
          className="flex min-w-0 flex-col gap-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="flex items-start gap-2">
            <span className="font-display text-base font-medium break-words">{row.app.title}</span>
            <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </span>
          {row.app.company && <span className="text-sm text-muted-foreground break-words">{row.app.company}</span>}
        </Link>
        <JobMenu app={row.app} />
      </div>
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
      <ArchivedJobs />
    </div>
  );
}
