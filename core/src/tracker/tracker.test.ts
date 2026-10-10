import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Tracker } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyMemoryProposal, loadMemory } from "../memory/index.js";
import { ensureRepo, fileHash, log, writeTextAtomic } from "../workspace/index.js";
import {
  addTrackerEvent,
  addTrackerFollowUp,
  deriveTracker,
  listTracker,
  loadTracker,
  markApplicationSent,
  putTracker,
  trackerQuestions,
} from "./index.js";

let root: string;
const id = "example";
const ws = () => ({ root });
const at = (date: string) => new Date(`${date}T12:00:00Z`);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-tracker-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await writeTextAtomic(root, `applications/${id}/meta.yaml`, "createdAt: '2026-10-01T12:00:00Z'\n");
  await ensureRepo(root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("keeps transition history, validates statuses, preserves fields, and computes stale/follow-up/funnel data", async () => {
  expect((await loadTracker(ws(), id)).status).toBe("draft");
  await putTracker(
    ws(),
    id,
    { status: "ready", source: "Community board", link: "https://example.test/job" },
    at("2026-10-01"),
  );
  await putTracker(ws(), id, { status: "applied", note: "Sent resume" }, at("2026-10-02"));
  const screening = await putTracker(ws(), id, { status: "screening" }, at("2026-10-03"));
  expect(screening.tracker.history.map((entry) => entry.status)).toEqual(["ready", "applied", "screening"]);
  expect(screening.tracker.appliedAt).toBe(at("2026-10-02").toISOString());
  expect(screening.tracker.source).toBe("Community board");
  await putTracker(ws(), id, { status: "screening" }, at("2026-10-03"));
  expect((await loadTracker(ws(), id)).history).toHaveLength(3);
  const noted = await putTracker(ws(), id, { note: "Asked for an update" }, at("2026-10-03"));
  expect(noted.tracker.history[3]).toMatchObject({ status: "screening", note: "Asked for an update" });
  await addTrackerFollowUp(ws(), id, { due: "2026-10-10", text: "Ask for an update", done: false }, at("2026-10-03"));
  const added = await addTrackerFollowUp(
    ws(),
    id,
    { due: "2026-10-05", text: "Earlier", done: true },
    at("2026-10-03"),
  );
  expect(deriveTracker(added.tracker, at("2026-10-17"))).toMatchObject({
    stale: false,
    daysSinceLastActivity: 14,
    nextFollowUpDue: "2026-10-10",
  });
  const list = await listTracker(ws(), at("2026-10-18"));
  expect(list.applications[0]?.derived).toMatchObject({ stale: true, daysSinceLastActivity: 15 });
  expect(list.funnel.screening).toBe(1);
  expect(list.funnel.applied).toBe(0);
  expect(deriveTracker({ ...added.tracker, status: "interviewing" }, at("2026-10-18")).stale).toBe(false);
  const before = await fileHash(root, `applications/${id}/tracker.yaml`);
  await expect(putTracker(ws(), id, { status: "invalid" as "ready" })).rejects.toThrow();
  expect(await fileHash(root, `applications/${id}/tracker.yaml`)).toBe(before);
  expect(Tracker.parse(added.tracker)).toEqual(added.tracker);
});
it("proposes outcome/interview memory, keeps contact data out, and exposes actual questions for prep", async () => {
  const event = await addTrackerEvent(
    ws(),
    id,
    { date: "2026-10-04", kind: "interview", notes: "Went well", questions: ["How do you recover from failures?"] },
    at("2026-10-04"),
  );
  expect(event.memoryProposals).toHaveLength(1);
  expect((await loadMemory(ws())).entries).toEqual([]);
  const proposal = event.memoryProposals[0];
  if (!proposal) throw new Error("Missing proposal");
  await applyMemoryProposal(ws(), proposal);
  expect((await loadMemory(ws())).entries[0]).toMatchObject({ kind: "outcome", source: "tracker" });
  expect(await trackerQuestions(ws())).toEqual([
    { applicationId: id, date: "2026-10-04", kind: "interview", question: "How do you recover from failures?" },
  ]);
  const outcome = await putTracker(
    ws(),
    id,
    {
      status: "rejected",
      outcome: { summary: "Another candidate selected", reasons: ["More experience"] },
      contacts: [
        { name: "Fictional Person", role: "Recruiter", channel: "person@example.test", notes: "Private contact" },
      ],
    },
    at("2026-10-05"),
  );
  expect(outcome.memoryProposals).toHaveLength(1);
  expect(JSON.stringify(outcome.memoryProposals)).not.toContain("person@example.test");
  const privateNote = await addTrackerEvent(
    ws(),
    id,
    { date: "2026-10-06", kind: "interview", notes: "Contact person@example.test", questions: [] },
    at("2026-10-06"),
  );
  expect(privateNote.memoryProposals).toEqual([]);
});
it("records committed resume and letter versions on sent and does not regress later statuses", async () => {
  await writeTextAtomic(root, `applications/${id}/resume.json`, "Resume v1");
  await writeTextAtomic(root, `applications/${id}/letter.json`, "Letter v1");
  const sent = await markApplicationSent(ws(), id, {}, at("2026-10-03"));
  expect(sent.tracker.status).toBe("applied");
  expect(sent.tracker.sentVersions[0]).toMatchObject({
    resume: expect.stringMatching(/^[a-f0-9]{40}$/),
    letter: expect.stringMatching(/^[a-f0-9]{40}$/),
    at: at("2026-10-03").toISOString(),
  });
  const version = sent.tracker.sentVersions[0];
  expect((await log(root, 2))[1]?.sha).toBe(version?.resume);
  await putTracker(ws(), id, { status: "interviewing" }, at("2026-10-04"));
  const again = await markApplicationSent(ws(), id, {}, at("2026-10-05"));
  expect(again.tracker.status).toBe("interviewing");
  expect(again.tracker.sentVersions).toHaveLength(2);
  expect(again.tracker.appliedAt).toBe(at("2026-10-03").toISOString());
  await expect(loadTracker(ws(), "../escape")).rejects.toThrow();
  await expect(putTracker(ws(), "missing", {})).rejects.toMatchObject({ code: "ENOENT" });
});
