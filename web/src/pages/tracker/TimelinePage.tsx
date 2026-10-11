import type { MemoryProposal, Tracker, TrackerStatus } from "@vita/shared";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useApplication, useTracker, useTrackerMutation } from "@/api/queries";
import { MemoryProposals } from "@/components/MemoryProposals";
import { PageError, PageLoading } from "@/components/PageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { allStatuses, isDue, statusLabel, today } from "@/lib/tracker-view";
import { JobTabs } from "../workspace/JobTabs";

const closing: TrackerStatus[] = ["offer", "accepted", "rejected", "withdrawn", "ghosted"];

export default function TimelinePage() {
  const { id = "" } = useParams();
  const app = useApplication(id);
  const query = useTracker(id);
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const collect = (result: { memoryProposals?: MemoryProposal[] }) => {
    if (result.memoryProposals?.length) setProposals((all) => [...all, ...(result.memoryProposals ?? [])]);
  };
  const put = useTrackerMutation(
    id,
    (body: Parameters<typeof api.tracker.put>[1]) => api.tracker.put(id, body),
    collect,
  );
  const addEvent = useTrackerMutation(
    id,
    (body: Parameters<typeof api.tracker.addEvent>[1]) => api.tracker.addEvent(id, body),
    collect,
  );
  const addFollowUp = useTrackerMutation(
    id,
    (body: Parameters<typeof api.tracker.addFollowUp>[1]) => api.tracker.addFollowUp(id, body),
    collect,
  );
  const sent = useTrackerMutation(
    id,
    (body: Parameters<typeof api.tracker.sent>[1]) => api.tracker.sent(id, body),
    collect,
  );
  const fail = (error: Error) => toast.error(error.message);
  const title = app.data
    ? [app.data.analysis.title, app.data.analysis.company].filter(Boolean).join(" at ")
    : "this job";
  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError error={query.error} retry={() => void query.refetch()} />;
  const { tracker, derived } = query.data;
  return (
    <div className="flex flex-col gap-6">
      <Button variant="link" className="h-11 w-fit px-0" asChild>
        <Link to="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-bold break-words">{title}</h1>
        <JobTabs id={id} current="timeline" />
      </header>
      {proposals.length > 0 && (
        <div className="max-w-xl rounded-xl border bg-card p-4">
          <MemoryProposals proposals={proposals} />
        </div>
      )}
      <section aria-label="Status" className="flex max-w-2xl flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="status">Where it stands</Label>
            <Select
              value={tracker.status}
              onValueChange={(status) => put.mutate({ status: status as TrackerStatus }, { onError: fail })}
            >
              <SelectTrigger id="status" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabel[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="h-11"
            disabled={sent.isPending}
            onClick={() =>
              sent.mutate(
                {},
                { onSuccess: () => toast.success("Marked as sent. This version is saved."), onError: fail },
              )
            }
          >
            Mark as sent
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {derived.stale && <Badge variant="outline">No activity for {derived.daysSinceLastActivity} days</Badge>}
          {derived.nextFollowUpDue && (
            <Badge variant={isDue(derived.nextFollowUpDue) ? "default" : "secondary"}>
              {isDue(derived.nextFollowUpDue) ? "Follow-up due" : "Next follow-up"}{" "}
              {derived.nextFollowUpDue.slice(0, 10)}
            </Badge>
          )}
          {tracker.appliedAt && <Badge variant="secondary">Applied {tracker.appliedAt.slice(0, 10)}</Badge>}
        </div>
        {tracker.sentVersions.length > 0 && (
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Versions you sent</p>
            <ul className="list-disc pl-5">
              {tracker.sentVersions.map((version) => (
                <li key={`${version.at}-${version.resume}`}>
                  {version.at.slice(0, 10)}: resume {version.resume.slice(0, 7)}
                  {version.letter ? `, cover letter ${version.letter.slice(0, 7)}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <EventsSection
        tracker={tracker}
        onAdd={(body) => addEvent.mutate(body, { onError: fail })}
        pending={addEvent.isPending}
      />
      <FollowUps
        tracker={tracker}
        pending={put.isPending || addFollowUp.isPending}
        onAdd={(body) => addFollowUp.mutate(body, { onError: fail })}
        onToggle={(followUps) => put.mutate({ followUps }, { onError: fail })}
      />
      <Contacts
        tracker={tracker}
        pending={put.isPending}
        onSave={(contacts) => put.mutate({ contacts }, { onError: fail })}
      />
      {closing.includes(tracker.status) && (
        <Outcome
          tracker={tracker}
          pending={put.isPending}
          onSave={(outcome) => put.mutate({ outcome }, { onError: fail })}
        />
      )}
      {tracker.history.length > 0 && (
        <section aria-label="History" className="flex max-w-2xl flex-col gap-2">
          <h2 className="font-display text-lg font-medium">History</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {[...tracker.history].reverse().map((entry) => (
              <li key={`${entry.at}-${entry.status}`} className="text-muted-foreground">
                <span className="font-medium text-foreground">{statusLabel[entry.status]}</span> ·{" "}
                {entry.at.slice(0, 10)}
                {entry.note ? ` · ${entry.note}` : ""}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function EventsSection({
  tracker,
  onAdd,
  pending,
}: {
  tracker: Tracker;
  onAdd: (body: { date: string; kind: string; notes: string; questions: string[] }) => void;
  pending: boolean;
}) {
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState("");
  const [notes, setNotes] = useState("");
  const [questions, setQuestions] = useState("");
  return (
    <section aria-label="Interviews and events" className="flex max-w-2xl flex-col gap-3">
      <h2 className="font-display text-lg font-medium">Interviews and events</h2>
      {tracker.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet. Add a call, interview or message here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {[...tracker.events]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((event) => (
              <li key={event.id} className="rounded-lg border bg-card p-3 text-sm">
                <p className="font-medium">
                  {event.kind} <span className="font-normal text-muted-foreground">· {event.date.slice(0, 10)}</span>
                </p>
                {event.notes && <p className="whitespace-pre-line break-words">{event.notes}</p>}
                {event.questions.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {event.questions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
        </ul>
      )}
      <form
        className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd({
            date,
            kind: kind.trim(),
            notes,
            questions: questions
              .split("\n")
              .map((q) => q.trim())
              .filter(Boolean),
          });
          setKind("");
          setNotes("");
          setQuestions("");
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="ev-date">Date</Label>
          <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="ev-kind">What happened</Label>
          <Input
            id="ev-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            placeholder="Phone screen, technical interview…"
            required
          />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="ev-notes">Notes</Label>
          <Textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="ev-questions">Questions they asked (one per line)</Label>
          <Textarea
            id="ev-questions"
            value={questions}
            onChange={(e) => setQuestions(e.target.value)}
            className="min-h-16"
          />
        </div>
        <Button type="submit" className="h-11 w-fit" disabled={pending || !kind.trim()}>
          Add to timeline
        </Button>
      </form>
    </section>
  );
}

function FollowUps({
  tracker,
  onAdd,
  onToggle,
  pending,
}: {
  tracker: Tracker;
  onAdd: (body: { due: string; text: string; done: boolean }) => void;
  onToggle: (followUps: Tracker["followUps"]) => void;
  pending: boolean;
}) {
  const [due, setDue] = useState(today());
  const [text, setText] = useState("");
  return (
    <section aria-label="Follow-ups" className="flex max-w-2xl flex-col gap-3">
      <h2 className="font-display text-lg font-medium">Follow-ups</h2>
      {tracker.followUps.length > 0 && (
        <ul className="flex flex-col gap-2">
          {[...tracker.followUps]
            .sort((a, b) => a.due.localeCompare(b.due))
            .map((followUp) => (
              <li key={followUp.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <Checkbox
                  id={`fu-${followUp.id}`}
                  checked={followUp.done}
                  disabled={pending}
                  className="mt-1"
                  onCheckedChange={(done) =>
                    onToggle(
                      tracker.followUps.map((entry) =>
                        entry.id === followUp.id ? { ...entry, done: done === true } : entry,
                      ),
                    )
                  }
                />
                <label htmlFor={`fu-${followUp.id}`} className="flex min-w-0 flex-1 cursor-pointer flex-col text-sm">
                  <span className={followUp.done ? "text-muted-foreground line-through" : "break-words"}>
                    {followUp.text}
                  </span>
                  <span
                    className={
                      !followUp.done && isDue(followUp.due) ? "font-medium text-destructive" : "text-muted-foreground"
                    }
                  >
                    {!followUp.done && isDue(followUp.due) ? "Due " : ""}
                    {followUp.due.slice(0, 10)}
                  </span>
                </label>
              </li>
            ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onAdd({ due, text: text.trim(), done: false });
          setText("");
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="fu-due">Due</Label>
          <Input id="fu-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-2">
          <Label htmlFor="fu-text">Follow up on</Label>
          <Input
            id="fu-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Send a thank-you note"
            required
          />
        </div>
        <Button type="submit" className="h-11" disabled={pending || !text.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

function Contacts({
  tracker,
  onSave,
  pending,
}: {
  tracker: Tracker;
  onSave: (contacts: Tracker["contacts"]) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [channel, setChannel] = useState("");
  return (
    <section aria-label="Contacts" className="flex max-w-2xl flex-col gap-3">
      <h2 className="font-display text-lg font-medium">People</h2>
      {tracker.contacts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tracker.contacts.map((contact) => (
            <li key={`${contact.name}-${contact.channel}`} className="rounded-lg border bg-card p-3 text-sm">
              <p className="font-medium break-words">{contact.name}</p>
              <p className="text-muted-foreground break-words">
                {[contact.role, contact.channel].filter(Boolean).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave([...tracker.contacts, { name: name.trim(), role, channel, notes: "" }]);
          setName("");
          setRole("");
          setChannel("");
        }}
      >
        <div className="flex min-w-36 flex-1 flex-col gap-2">
          <Label htmlFor="ct-name">Name</Label>
          <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-2">
          <Label htmlFor="ct-role">Role</Label>
          <Input id="ct-role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Recruiter" />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-2">
          <Label htmlFor="ct-channel">How to reach them</Label>
          <Input
            id="ct-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="Email, LinkedIn…"
          />
        </div>
        <Button type="submit" className="h-11" disabled={pending || !name.trim()}>
          Add
        </Button>
      </form>
    </section>
  );
}

function Outcome({
  tracker,
  onSave,
  pending,
}: {
  tracker: Tracker;
  onSave: (outcome: { summary: string; reasons: string[] }) => void;
  pending: boolean;
}) {
  const [summary, setSummary] = useState(tracker.outcome?.summary ?? "");
  const [reasons, setReasons] = useState((tracker.outcome?.reasons ?? []).join("\n"));
  return (
    <section aria-label="Outcome" className="flex max-w-2xl flex-col gap-3">
      <h2 className="font-display text-lg font-medium">How it ended</h2>
      <p className="text-sm text-muted-foreground">What you learn here helps Vita write better next time.</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-summary">In a sentence</Label>
        <Input id="out-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="out-reasons">Reasons (one per line)</Label>
        <Textarea id="out-reasons" value={reasons} onChange={(e) => setReasons(e.target.value)} className="min-h-16" />
      </div>
      <Button
        className="h-11 w-fit"
        disabled={pending || !summary.trim()}
        onClick={() =>
          onSave({
            summary: summary.trim(),
            reasons: reasons
              .split("\n")
              .map((r) => r.trim())
              .filter(Boolean),
          })
        }
      >
        Save outcome
      </Button>
    </section>
  );
}
