import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import {
  type ArchivedFilter,
  MemoryInput,
  type MemoryProposal,
  PutTrackerRequest,
  SentRequest,
  Slug,
  Tracker,
  TrackerEventInput,
  TrackerFollowUpInput,
  TrackerStatus,
} from "@vita/shared";
import { parse as parseYaml, stringify } from "yaml";
import { proposeMemory } from "../memory/index.js";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import {
  commitPaths,
  FileLocks,
  fileHash,
  log,
  readText,
  resolveInWorkspace,
  writeTextAtomic,
} from "../workspace/index.js";

const locks = new FileLocks();
function prefix(id: string) {
  return `applications/${Slug.parse(id)}`;
}
async function requireApplication(ws: Pick<WorkspaceHandle, "root">, id: string) {
  await readText(ws.root, `${prefix(id)}/meta.yaml`);
}
export async function loadTracker(ws: Pick<WorkspaceHandle, "root">, id: string): Promise<Tracker> {
  await requireApplication(ws, id);
  const text = await optionalText(ws.root, `${prefix(id)}/tracker.yaml`);
  if (text !== undefined) return Tracker.parse(parseYaml(text));
  const meta = parseYaml(await readText(ws.root, `${prefix(id)}/meta.yaml`)) ?? {};
  return Tracker.parse(typeof meta.createdAt === "string" ? { updatedAt: meta.createdAt } : {});
}
export function deriveTracker(tracker: Tracker, now = new Date(), createdAt?: string) {
  const times = [
    createdAt,
    tracker.appliedAt,
    tracker.updatedAt,
    ...tracker.history.map((entry) => entry.at),
    ...tracker.events.map((event) => event.at),
    ...tracker.sentVersions.map((version) => version.at),
  ]
    .filter((value): value is string => !!value)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value) && value <= now.getTime());
  const lastActivity = times.length ? Math.max(...times) : now.getTime();
  const daysSinceLastActivity = Math.max(0, Math.floor((now.getTime() - lastActivity) / 86_400_000));
  return {
    nextFollowUpDue:
      tracker.followUps.filter((entry) => !entry.done).sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0]?.due ??
      null,
    daysSinceLastActivity,
    stale: ["applied", "screening"].includes(tracker.status) && now.getTime() - lastActivity > 14 * 86_400_000,
  };
}
export async function listTracker(ws: Pick<WorkspaceHandle, "root">, now = new Date(), archived?: ArchivedFilter) {
  const funnel = Object.fromEntries(TrackerStatus.options.map((status) => [status, 0])) as Record<
    TrackerStatus,
    number
  >;
  let dirs: string[];
  try {
    dirs = await readdir(resolveInWorkspace(ws.root, "applications"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    dirs = [];
  }
  const applications = [];
  for (const id of dirs.sort()) {
    if (!Slug.safeParse(id).success) continue;
    const meta = await optionalText(ws.root, `${prefix(id)}/meta.yaml`);
    if (meta === undefined) continue;
    const isArchived = !!parseYaml(meta)?.archived;
    if (archived === "only" ? !isArchived : archived !== "include" && isArchived) continue;
    const tracker = await loadTracker(ws, id);
    const createdAt = parseYaml(meta)?.createdAt;
    applications.push({
      id,
      tracker,
      derived: deriveTracker(tracker, now, typeof createdAt === "string" ? createdAt : undefined),
    });
    funnel[tracker.status]++;
  }
  return { applications, funnel };
}

function outcomeInputs(id: string, tracker: Tracker, previous: Tracker): MemoryInput[] {
  const inputs: MemoryInput[] = [];
  if (tracker.outcome && JSON.stringify(tracker.outcome) !== JSON.stringify(previous.outcome))
    inputs.push({
      kind: "outcome",
      text: `${id}: ${tracker.outcome.summary}${tracker.outcome.reasons.length ? `; ${tracker.outcome.reasons.join("; ")}` : ""}`,
    });
  for (const event of tracker.events.filter((entry) => !previous.events.some((old) => old.id === entry.id)))
    if (event.notes || event.questions.length)
      inputs.push({
        kind: "outcome",
        text: `${id}, ${event.kind} (${event.date}): ${event.notes}${event.questions.length ? `; asked: ${event.questions.join("; ")}` : ""}`,
      });
  // Contact details and secrets in tracker notes never enter memory proposals.
  return inputs
    .map((input) => ({ ...input, text: input.text.replace(/[\r\n]+/g, " ") }))
    .filter((input) => MemoryInput.safeParse(input).success);
}
async function mutateTracker(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  now: Date,
  change: (tracker: Tracker) => Promise<void> | void,
) {
  const rel = `${prefix(id)}/tracker.yaml`;
  const release = await locks.acquire(resolveInWorkspace(ws.root, rel), "tracker");
  try {
    const expected = await fileHash(ws.root, rel);
    const previous = await loadTracker(ws, id);
    const tracker = structuredClone(previous);
    await change(tracker);
    tracker.updatedAt = now.toISOString();
    const validated = Tracker.parse(tracker);
    const memoryProposals: MemoryProposal[] = [];
    for (const input of outcomeInputs(id, tracker, previous))
      memoryProposals.push(await proposeMemory(ws, input, "tracker", now));
    if ((await fileHash(ws.root, rel)) !== expected) throw new Error("Tracker changed while saving");
    await writeTextAtomic(ws.root, rel, stringify(validated, { lineWidth: 0 }));
    const sha = await commitPaths(ws.root, [rel], `Update application tracker: ${id}`, "user");
    return { tracker: validated, derived: deriveTracker(validated, now), memoryProposals, sha };
  } finally {
    release();
  }
}
function status(tracker: Tracker, next: TrackerStatus, at: string, note = "") {
  if (next !== tracker.status || note) {
    tracker.status = next;
    tracker.history.push({ status: next, at, note });
  }
  if (next === "applied") tracker.appliedAt ??= at;
}
export async function putTracker(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  input: PutTrackerRequest,
  now = new Date(),
) {
  const { status: next, note, link, outcome, ...fields } = PutTrackerRequest.parse(input);
  return mutateTracker(ws, id, now, (tracker) => {
    Object.assign(tracker, fields);
    if (link === null) delete tracker.link;
    else if (link !== undefined) tracker.link = link;
    if (outcome === null) delete tracker.outcome;
    else if (outcome !== undefined) tracker.outcome = outcome;
    if (next || note) status(tracker, next ?? tracker.status, now.toISOString(), note);
  });
}
export async function addTrackerEvent(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  input: TrackerEventInput,
  now = new Date(),
) {
  const event = TrackerEventInput.parse(input);
  return mutateTracker(ws, id, now, (tracker) => {
    tracker.events.push({ ...event, id: randomUUID(), at: now.toISOString() });
  });
}
export async function addTrackerFollowUp(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  input: TrackerFollowUpInput,
  now = new Date(),
) {
  const followUp = TrackerFollowUpInput.parse(input);
  return mutateTracker(ws, id, now, (tracker) => {
    tracker.followUps.push({ ...followUp, id: randomUUID() });
  });
}
/** Exporting records the checked resume snapshot without changing application status. */
export async function recordExportedVersion(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  now = new Date(),
  kind: "resume" | "letter" = "resume",
) {
  const head = (await log(ws.root, 1))[0]?.sha;
  if (!head) throw new Error("No document commit is available");
  return mutateTracker(ws, id, now, (tracker) => {
    if (kind === "letter") {
      // Pair the letter with the most recently exported resume version (or this commit when none yet).
      const resume = tracker.sentVersions.at(-1)?.resume ?? head;
      tracker.sentVersions.push({ resume, letter: head, at: now.toISOString() });
    } else tracker.sentVersions.push({ resume: head, at: now.toISOString() });
  });
}

export async function markApplicationSent(
  ws: Pick<WorkspaceHandle, "root">,
  id: string,
  input: SentRequest = {},
  now = new Date(),
) {
  const request = SentRequest.parse(input);
  return mutateTracker(ws, id, now, async (tracker) => {
    const rel = `${prefix(id)}/resume.json`;
    await readText(ws.root, rel);
    const letter = await optionalText(ws.root, `${prefix(id)}/letter.json`);
    // Snapshot only the documents being sent. The resulting commit contains both versions.
    await commitPaths(
      ws.root,
      [rel, ...(letter === undefined ? [] : [`${prefix(id)}/letter.json`])],
      `Record sent documents: ${id}`,
      "user",
    );
    const head = (await log(ws.root, 1))[0]?.sha;
    if (!head) throw new Error("No document commit is available");
    tracker.sentVersions.push({
      resume: request.resume ?? head,
      ...(request.letter || letter !== undefined ? { letter: request.letter ?? head } : {}),
      at: now.toISOString(),
    });
    if (["draft", "ready"].includes(tracker.status)) status(tracker, "applied", now.toISOString(), "Marked as sent");
    tracker.appliedAt ??= now.toISOString();
  });
}
export async function trackerQuestions(ws: Pick<WorkspaceHandle, "root">) {
  const { applications } = await listTracker(ws);
  return applications.flatMap(({ id, tracker }) =>
    tracker.events.flatMap((event) =>
      event.questions.map((question) => ({ applicationId: id, date: event.date, kind: event.kind, question })),
    ),
  );
}
