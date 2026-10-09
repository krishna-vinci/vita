import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pack, Resume } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applySourceEdit } from "../chat/index.js";
import { buildClaimIndex } from "../claims/index.js";
import { lintResume } from "../lint/index.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { ensureRepo, log, readText, writeTextAtomic } from "../workspace/index.js";
import { answerMetric, dismissMetric, metricQuestions } from "./index.js";

const source = `Keep this preamble.\n## Workshop\n\n\`\`\`yaml\n# Keep this comment\nkind: role\ncustom: { keep: true }\nevidence: []\n\`\`\`\n\n### Claims\n- Prepared materials. <!-- c:workshop-materials -->\n\n### Notes\nKeep these exact words.\n\n## Archive\n\`\`\`yaml\nkind: project\nevidence: []\n\`\`\`\n### Claims\n- Built an archive. <!-- c:archive-built -->\n`;
let ws: WorkspaceHandle;

beforeEach(async () => {
  ws = {
    root: await mkdtemp(join(tmpdir(), "vita-metrics-")),
    bundledDir: fileURLToPath(new URL("../../../", import.meta.url)),
  };
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await writeTextAtomic(ws.root, "projects.md", source);
  await ensureRepo(ws.root);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(ws.root, { recursive: true, force: true });
});

async function base(id: string, item: { source?: string; claims: string[] }, packs: string[]) {
  await writeTextAtomic(ws.root, `resumes/${id}/base.yaml`, `name: ${id}\npacks: ${JSON.stringify(packs)}\n`);
  await writeTextAtomic(
    ws.root,
    `resumes/${id}/resume.json`,
    JSON.stringify(
      Resume.parse({
        id,
        kind: "base",
        parent: "master",
        template: "rover-base",
        header: { name: "Alex" },
        sections: [
          {
            id: "work",
            title: "Work",
            kind: "entries",
            items: [
              {
                id: "selected",
                title: "Selected work",
                source: item.source,
                bullets: [{ id: "bullet", text: "Prepared materials.", claims: item.claims }],
              },
            ],
          },
        ],
      }),
    ),
  );
}

it("generates deterministic item questions, merges packs of including bases and falls back to general", async () => {
  await writeTextAtomic(
    ws.root,
    "packs/service/pack.yaml",
    "id: service\nname: Service\nextends: general\nmetric_questions: [What was the attendance?]\n",
  );
  await writeTextAtomic(
    ws.root,
    "packs/quality/pack.yaml",
    "id: quality\nname: Quality\nmetric_questions: [How many checks did you complete?]\n",
  );
  await base("service", { claims: ["workshop-materials"] }, ["service"]);
  await base("quality", { source: "workshop", claims: [] }, ["quality"]);
  const first = await metricQuestions(ws, {});
  expect(await metricQuestions(ws, {})).toEqual(first);
  expect(new Set(first.map((q) => q.id)).size).toBe(first.length);
  expect(first.filter((q) => q.itemSlug === "workshop")).toHaveLength(7);
  expect(first).toContainEqual(
    expect.objectContaining({ itemSlug: "workshop", question: "Workshop: What was the attendance?" }),
  );
  expect(first.filter((q) => q.itemSlug === "archive")).toHaveLength(5);
  expect(await metricQuestions(ws, { itemSlug: "workshop", limit: 2 })).toEqual(first.slice(0, 2));
  expect(await readText(ws.root, "projects.md")).toBe(source);
});

it("proposes dated evidence and metrics, preserves user text, and lint accepts only the cited number after apply", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 9, 12));
  const question = (await metricQuestions(ws, { itemSlug: "workshop" }))[0];
  if (!question) throw new Error("Missing question");
  const proposal = await answerMetric(ws, {
    questionId: question.id,
    answer: "about 30 users",
    claimId: "workshop-materials",
  });
  expect(await readText(ws.root, "projects.md")).toBe(source);
  expect(proposal.after).toContain("# Keep this comment");
  expect(proposal.after).toContain("### Notes\nKeep these exact words.");
  expect(proposal.after.slice(proposal.after.indexOf("## Archive"))).toBe(source.slice(source.indexOf("## Archive")));
  await applySourceEdit(ws, proposal);
  const { doc, issues } = parseProjects(await readText(ws.root, "projects.md"));
  expect(issues).toEqual([]);
  const claim = doc.items[0]?.claims[0];
  const evidence = doc.items[0]?.meta.evidence[0];
  expect(evidence).toMatchObject({ kind: "statement", text: "about 30 users", at: "2026-10-09" });
  expect(claim).toMatchObject({
    evidence: [evidence?.id],
    metrics: [{ value: "30", kind: "measured", evidence: [evidence?.id] }],
  });
  const resume = Resume.parse({
    id: "master",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Alex" },
    sections: [
      {
        id: "work",
        title: "Work",
        kind: "entries",
        items: [
          {
            id: "workshop",
            title: "Workshop",
            bullets: [
              { id: "supported", text: "Served 30 users.", claims: ["workshop-materials"] },
              { id: "unsupported", text: "Served 31 users.", claims: ["workshop-materials"] },
            ],
          },
        ],
      },
    ],
  });
  expect(
    lintResume(resume, {
      index: buildClaimIndex(doc, parseOutline("")),
      pack: Pack.parse({ id: "general", name: "General" }),
      rules: {},
    }),
  ).toEqual([expect.objectContaining({ rule: "unsourced-number", bulletId: "unsupported" })]);
  expect(await metricQuestions(ws, { itemSlug: "workshop" })).toEqual([]);
});

it("stores a nonnumeric answer only in projects, creates a claim when none is chosen and skips that answered question", async () => {
  const first = await metricQuestions(ws, { itemSlug: "workshop" });
  const question = first[0];
  if (!question) throw new Error("Missing question");
  const answer = "I did not measure it.\n### This is part of my answer";
  const proposal = await answerMetric(ws, { questionId: question.id, answer });
  await applySourceEdit(ws, proposal);
  const item = parseProjects(await readText(ws.root, "projects.md")).doc.items[0];
  expect(item?.claims).toHaveLength(2);
  expect(item?.claims.find((claim) => claim.evidence.includes(item.meta.evidence[0]?.id ?? ""))).toMatchObject({
    text: "Workshop: I did not measure it. ### This is part of my answer",
    metrics: [],
  });
  expect(item?.meta.evidence[0]?.text).toBe(answer);
  const remaining = await metricQuestions(ws, { itemSlug: "workshop" });
  expect(remaining.map((q) => q.id)).toEqual(first.slice(1).map((q) => q.id));
  await expect(readText(ws.root, ".vita/answers.yaml")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(answerMetric(ws, { questionId: question.id, answer: "again" })).rejects.toThrow("Question");
});

it("dismisses persistently and idempotently without modifying projects or losing concurrent dismissals", async () => {
  const questions = await metricQuestions(ws, {});
  const ids = questions.slice(0, 2).map((q) => q.id);
  await Promise.all(ids.map((id) => dismissMetric(ws, id)));
  const saved = await readText(ws.root, "config/dismissed-questions.yaml");
  await dismissMetric(ws, ids[0] ?? "");
  expect(await readText(ws.root, "config/dismissed-questions.yaml")).toBe(saved);
  expect((await metricQuestions(ws, {})).map((q) => q.id)).toEqual(questions.slice(2).map((q) => q.id));
  expect(await readText(ws.root, "projects.md")).toBe(source);
  expect(await log(ws.root, 2)).toHaveLength(2);
});

it("rejects unknown questions, empty answers, foreign claims and stale source proposals", async () => {
  const question = (await metricQuestions(ws, { itemSlug: "workshop" }))[0];
  if (!question) throw new Error("Missing question");
  await expect(answerMetric(ws, { questionId: "unknown", answer: "30" })).rejects.toThrow("Question");
  await expect(answerMetric(ws, { questionId: question.id, answer: " " })).rejects.toThrow();
  await expect(answerMetric(ws, { questionId: question.id, answer: "30", claimId: "archive-built" })).rejects.toThrow(
    "claim",
  );
  const proposal = await answerMetric(ws, { questionId: question.id, answer: "30" });
  await writeTextAtomic(ws.root, "projects.md", `${source}\nChanged outside Vita.\n`);
  await expect(applySourceEdit(ws, proposal)).rejects.toMatchObject({ code: "stale-hash" });
});

it("records numeric answers including year-shaped counts, percentages, currency, ranges and repeated values", async () => {
  const question = (await metricQuestions(ws, { itemSlug: "workshop" }))[0];
  if (!question) throw new Error("Missing question");
  const proposal = await answerMetric(ws, {
    questionId: question.id,
    answer: "2026 visitors, $1,000 saved, 12.5% fewer errors, 2x throughput, 10-20 checks, and 2026 visitors again",
  });
  const item = parseProjects(proposal.after).doc.items[0];
  const claim = item?.claims.find((entry) => entry.evidence.includes(item.meta.evidence[0]?.id ?? ""));
  expect(claim?.metrics.map((metric) => metric.value)).toEqual(["2026", "$1,000", "12.5%", "2x", "10", "20"]);
});

it("adds missing metadata, anchors an existing claim, and keeps CRLF and sources without a final newline", async () => {
  for (const newline of ["\n", "\r\n"]) {
    await writeTextAtomic(ws.root, "projects.md", ["## Workshop", "### Claims", "- Prepared materials."].join(newline));
    const question = (await metricQuestions(ws, {}))[0];
    if (!question) throw new Error("Missing question");
    const proposal = await answerMetric(ws, { questionId: question.id, claimId: question.claimId, answer: "30" });
    const { doc, issues } = parseProjects(proposal.after);
    expect(issues).toEqual([]);
    expect(doc.items[0]?.claims).toHaveLength(1);
    expect(doc.items[0]?.claims[0]).toMatchObject({
      id: question.claimId,
      metrics: [{ value: "30", kind: "measured" }],
    });
    expect(doc.items[0]?.meta.evidence[0]?.text).toBe("30");
    if (newline === "\r\n") expect(proposal.after.replace(/\r\n/g, "")).not.toContain("\n");
  }
});

it("refuses to append an answer into an unclosed fence or malformed item metadata", async () => {
  for (const source of ["## Workshop\n```text\nUnclosed example", "## Workshop\n```yaml\nlinks: 3\n```\n"]) {
    await writeTextAtomic(ws.root, "projects.md", source);
    const question = (await metricQuestions(ws, {}))[0];
    if (!question) throw new Error("Missing question");
    await expect(answerMetric(ws, { questionId: question.id, answer: "30" })).rejects.toMatchObject({
      code: "source-format",
    });
    expect(await readText(ws.root, "projects.md")).toBe(source);
  }
});
