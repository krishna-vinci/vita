import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseConfig, type CheckNote, type Resume, visibleBullets } from "@vita/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agent from "../agent/index.js";
import { createGenerationRuntime } from "../agent/roles.js";
import * as rendering from "../render/index.js";
import { type Context, effectivePack, loadContext } from "./context.js";
import { baseSummaries, checkerContext, VerdictCache, writerEvidence } from "./efficient-context.js";
import { type GenerationInput, generate } from "./generate.js";
import { citeFixtureSummary } from "./test-fixtures.js";
import type { PipelineDeps } from "./types.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let ctx: Context;
let resume: Resume;
let input: GenerationInput;
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
function firstItem(value: Resume) {
  return required(value.sections.flatMap((section) => section.items)[0]);
}
const notes = (resume: Resume, verdict: CheckNote["verdict"] = "supported"): CheckNote[] =>
  visibleBullets(resume).map((bullet) => ({ bulletId: bullet.id, verdict, reason: "Compared complete receipts" }));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-efficiency-"));
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  ctx = await loadContext({ root, bundledDir });
  resume = citeFixtureSummary(required(ctx.master));
  input = {
    kind: "job",
    id: "test-job",
    parent: "master",
    template: "rover-base",
    maxPages: 1,
    seed: resume,
    analysis: { title: "Role", requirements: [], baseScores: [] },
    pack: await effectivePack(ctx),
    gaps: [],
  };
});
afterEach(async () => {
  ctx.search.close();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("packs every visible cited claim, complete evidence, metrics, limits and parent; marks unknown claims", () => {
  const bullet = required(visibleBullets(resume)[0]);
  const claim = required(ctx.index.claims.get(required(bullet.claims[0])));
  claim.metrics = [{ value: "12", kind: "counted", evidence: ["ev-test"] }];
  claim.evidence = [
    { id: "ev-test", kind: "statement", text: "Complete receipt, including its caveat.", at: "2026-10-10" },
  ];
  claim.limits = ["Assisted; did not lead."];
  bullet.claims.push("unknown-claim");
  const pack = checkerContext(resume, ctx.index);
  expect(pack.map((entry) => entry.bullet.id)).toEqual(visibleBullets(resume).map((bullet) => bullet.id));
  for (const entry of pack)
    for (const id of entry.bullet.claims)
      expect(entry.claims).toContainEqual(ctx.index.claims.get(id) ?? { id, missing: true });
  expect(pack[0]?.claims).toContainEqual(claim);
  expect(pack[0]?.item.title).toBe(firstItem(resume).title);
  required(
    resume.sections.find((section) =>
      section.items.some((item) => item.bullets.some((entry) => entry.id === bullet.id)),
    ),
  ).hidden = true;
  expect(checkerContext(resume, ctx.index).some((entry) => entry.bullet.id === bullet.id)).toBe(false);
});

it("keeps selected variants plus seed, answer and must-cover claims without sending whole sources", () => {
  const ids = [...ctx.index.claims.keys()];
  const original = required([...ctx.index.claims.values()].find((claim) => claim.itemSlug !== null));
  const variant = {
    id: "v-selected",
    text: original.text,
    label: null,
    itemSlug: required(original.itemSlug ?? undefined),
  };
  ctx.index.variants.set(variant.id, variant);
  ctx.index.claims.set(variant.id, { ...original, id: variant.id });
  input.selection = {
    claimIds: [required(ids[0])],
    items: [{ itemSlug: "test", claimIds: [], variantIds: [variant.id] }],
  };
  input.answerClaims = [{ id: required(ids[2]), text: "Answer" }];
  input.mustCover = [{ requirementId: "req", requirement: "Work", claimIds: [required(ids[3])] }];
  const evidence = writerEvidence(ctx, input);
  expect(evidence.variants).toContainEqual(variant);
  expect(evidence.claims).toContainEqual(ctx.index.claims.get(variant.id));
  const selected = new Set(evidence.claims.map((claim) => claim.id));
  for (const id of [...ids.slice(0, 4), ...visibleBullets(resume).flatMap((bullet) => bullet.claims)])
    expect(selected.has(id)).toBe(true);
  expect(evidence).not.toHaveProperty("outlineText");
  expect(evidence).not.toHaveProperty("projectsText");
  expect(evidence.outlineItems.length).toBeGreaterThan(0);
});

it("summarises bases with skills and titles without full resume or source text", () => {
  const summaries = baseSummaries([
    {
      id: "direction",
      config: BaseConfig.parse({ name: "Direction", emphasis: { skills_first: ["Communication"] } }),
      resume,
    },
  ]);
  expect(summaries[0]).toMatchObject({
    id: "direction",
    name: "Direction",
    packs: ["general"],
    topSkills: expect.arrayContaining(["Communication"]),
    itemTitles: expect.arrayContaining([firstItem(resume).title]),
  });
  expect(summaries[0]).not.toHaveProperty("resume");
});

describe("run-scoped supported verdict cache", () => {
  it.each(["unsupported", "overstated"] as const)("never caches %s verdicts", (verdict) => {
    const cache = new VerdictCache();
    cache.remember(resume, ctx.index, notes(resume, verdict));
    expect(cache.partition(resume, ctx.index).cached).toEqual([]);
    cache.remember(resume, ctx.index, notes(resume));
    cache.remember(resume, ctx.index, notes(resume, verdict));
    expect(cache.partition(resume, ctx.index).cached).toEqual([]);
  });

  it("reuses identical supported text and sorted claim ids after edits but rechecks changed text or claims", () => {
    const cache = new VerdictCache();
    const bullet = required(visibleBullets(resume)[0]);
    bullet.claims.push(required([...ctx.index.claims.keys()].find((id) => !bullet.claims.includes(id))));
    cache.remember(resume, ctx.index, notes(resume));
    const edited = structuredClone(resume);
    const changed = required(visibleBullets(edited)[0]);
    changed.claims.reverse();
    changed.locked = !changed.locked;
    changed.origin = "user";
    expect(cache.partition(edited, ctx.index).pending.size).toBe(0);
    changed.text += " ";
    expect(cache.partition(edited, ctx.index).pending.has(changed.id)).toBe(true);
    changed.text = bullet.text;
    changed.claims.pop();
    expect(cache.partition(edited, ctx.index).pending.has(changed.id)).toBe(true);
  });

  it("invalidates for item, evidence or checker-model changes and rejects conflicting verdicts", () => {
    const cache = new VerdictCache();
    cache.useModel("faux/checker");
    cache.remember(resume, ctx.index, notes(resume));
    const edited = structuredClone(resume);
    firstItem(edited).title = "Another employer";
    expect(cache.partition(edited, ctx.index).pending.size).toBeGreaterThan(0);
    required(ctx.index.claims.get(required(required(visibleBullets(resume)[0]).claims[0]))).limits.push(
      "New limitation",
    );
    expect(cache.partition(resume, ctx.index).pending.size).toBeGreaterThan(0);
    cache.useModel("faux/other-checker");
    expect(cache.partition(resume, ctx.index).cached).toEqual([]);
    const first = required(notes(resume)[0]);
    cache.remember(resume, ctx.index, [...notes(resume), { ...first, verdict: "unsupported" }]);
    expect(cache.partition(resume, ctx.index).pending.has(first.bulletId)).toBe(true);
  });
});

it("lints first, starts checker/ATS/render concurrently, then joins unchanged done criteria", async () => {
  let releaseRender!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseRender = resolve;
  });
  const started: string[] = [];
  const progress: string[] = [];
  vi.spyOn(rendering, "compileTex").mockImplementation(async () => {
    started.push("render");
    await gate;
    return { pdf: Buffer.from("fake"), log: "" };
  });
  vi.spyOn(rendering, "pdfText").mockResolvedValue({
    pages: 1,
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
  });
  vi.spyOn(agent, "runRole").mockImplementation(async (opts) => {
    if (opts.role.name === "writer") return resume as never;
    started.push(opts.role.name);
    if (opts.role.name === "checker") {
      await gate;
      return { checks: notes(resume) } as never;
    }
    expect(opts.tools.render).toBeDefined();
    await opts.tools.render;
    return { ats: [] } as never;
  });
  const deps = {
    runtime: {},
    models: { default: "faux/default", roles: { writer: "faux/writer", checker: "faux/checker" } },
    onProgress: (event: { stage: string }) => progress.push(event.stage),
  } as unknown as PipelineDeps;
  const pending = generate(ctx, input, deps, [], { name: "Fictional", contact: [] });
  await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(["checker", "ats-reviewer", "render"])));
  expect(progress.indexOf("lint")).toBeLessThan(progress.indexOf("check"));
  releaseRender();
  const result = await pending;
  expect(result.review).toMatchObject({
    round: 1,
    done: true,
    lint: [],
    checks: notes(resume),
    ats: [],
    render: { ok: true },
  });
});

it("revises in the same writer session with review notes and rechecks only non-supported lines", async () => {
  const calls: agent.RunRoleOptions<unknown>[] = [];
  const first = notes(resume);
  required(first[0]).verdict = "unsupported";
  let checks = 0;
  vi.spyOn(rendering, "compileTex").mockResolvedValue({ pdf: Buffer.from("fake"), log: "" });
  vi.spyOn(rendering, "pdfText").mockResolvedValue({
    pages: 1,
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
  });
  vi.spyOn(agent, "runRole").mockImplementation(async (opts) => {
    calls.push(opts);
    if (opts.role.name === "writer") return resume as never;
    if (opts.role.name === "checker") return { checks: ++checks === 1 ? first : [notes(resume)[0]] } as never;
    return { ats: [] } as never;
  });
  const result = await generate(
    ctx,
    input,
    {
      runtime: {},
      models: { default: "faux/default", roles: { writer: "faux/writer", checker: "faux/checker" } },
    } as PipelineDeps,
    [],
    { name: "Fictional", contact: [] },
  );
  expect(result.review).toMatchObject({ round: 2, done: true });
  const writers = calls.filter((call) => call.role.name === "writer");
  expect(required(writers[1]).session).toBe(required(writers[0]).session);
  expect(required(writers[1]).task).toContain("unsupported");
  expect(required(writers[1]).task).not.toContain('source="selected claims');
  const checkers = calls.filter((call) => call.role.name === "checker");
  expect(visibleBullets(required(required(checkers[1]).tools.resume))).toHaveLength(1);
});

it("drains concurrent render and ATS work before surfacing a checker failure", async () => {
  let release!: () => void;
  let renderStarted = false;
  let settled = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(rendering, "compileTex").mockImplementation(async () => {
    renderStarted = true;
    await gate;
    return { pdf: Buffer.from("fake"), log: "" };
  });
  vi.spyOn(rendering, "pdfText").mockResolvedValue({
    pages: 1,
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
  });
  vi.spyOn(agent, "runRole").mockImplementation(async (opts) => {
    if (opts.role.name === "writer") return resume as never;
    if (opts.role.name === "checker") throw new Error("Checker unavailable");
    await opts.tools.render;
    return { ats: [] } as never;
  });
  const pending = generate(
    ctx,
    input,
    {
      runtime: {},
      models: { default: "faux/default", roles: { writer: "faux/writer", checker: "faux/checker" } },
    } as PipelineDeps,
    [],
    { name: "Fictional", contact: [] },
  ).catch((error: unknown) => {
    settled = true;
    return error;
  });
  await vi.waitFor(() => expect(renderStarted).toBe(true));
  expect(settled).toBe(false);
  release();
  expect(await pending).toMatchObject({ message: "Checker unavailable" });
});

it("deepens once below the fill floor only when unused relevant claims remain, metering the extra pass", async () => {
  const { loadProfile } = await import("./profile.js");
  const { selectEvidence } = await import("../search/index.js");
  const selection = selectEvidence(ctx.search, ctx.index, {
    keywords: [["catalogue", "catalog"]],
    lead: [],
    locked: [],
    maxClaims: 40,
  });
  const candidate = selection.items[0];
  if (!candidate) throw new Error("Missing relevant fixture item");
  const unused = "unused-relevant";
  const claim = required(ctx.index.claims.get(required(candidate.claimIds[0])));
  ctx.index.claims.set(unused, { ...claim, id: unused, text: "Added catalogue filters." });
  candidate.claimIds.push(unused);
  selection.claimIds.push(unused);
  selection.claimScores = { ...selection.claimScores, [unused]: 1 };
  candidate.relevance = 1;
  input.selection = selection;
  input.depthSelection = selection;
  vi.spyOn(rendering, "compileTex").mockResolvedValue({ pdf: Buffer.from("stub"), log: "" });
  vi.spyOn(rendering, "pdfText").mockResolvedValue({
    text: visibleBullets(resume)
      .map((bullet) => bullet.text)
      .join("\n"),
    pages: 1,
    fill: 0.5,
  });
  const deeper = structuredClone(resume);
  const target = deeper.sections
    .flatMap((section) => section.items)
    .find((item) => item.bullets.some((bullet) => bullet.claims.includes(claim.id)));
  if (!target) throw new Error("Missing matching item");
  target.bullets.push({
    id: "added-depth",
    text: "Added catalogue filters.",
    claims: [unused],
    origin: "ai",
    locked: false,
  });
  vi.mocked(rendering.pdfText)
    .mockResolvedValueOnce({
      text: visibleBullets(resume)
        .map((bullet) => bullet.text)
        .join("\n"),
      pages: 1,
      fill: 0.5,
    })
    .mockResolvedValue({
      text: visibleBullets(deeper)
        .map((bullet) => bullet.text)
        .join("\n"),
      pages: 1,
      fill: 0.5,
    });
  const faux = await createGenerationRuntime([
    { tool: "submit_resume", arguments: resume },
    { tool: "submit_checks", arguments: { checks: notes(resume) } },
    { tool: "submit_ats", arguments: { ats: [] } },
    { tool: "submit_resume", arguments: deeper },
    {
      tool: "submit_checks",
      arguments: { checks: [{ bulletId: "added-depth", verdict: "supported", reason: "Unused relevant claim" }] },
    },
    { tool: "submit_ats", arguments: { ats: [] } },
  ]);
  try {
    if (!faux.models) throw new Error("Missing models");
    const spy = vi.spyOn(agent, "runRole");
    const usage: import("./types.js").RoleUsage[] = [];
    const result = await generate(
      ctx,
      input,
      { runtime: faux.runtime, models: faux.models, retry: { enabled: false } },
      usage,
      await loadProfile(root),
    );
    expect(result.review.done).toBe(true);
    const writers = spy.mock.calls.filter(([opts]) => opts.role.name === "writer");
    expect(writers).toHaveLength(2);
    expect(writers[1]?.[0].task).toContain("Deepen this resume once");
    expect(writers[1]?.[0].task).toContain(unused);
    expect(usage.filter((entry) => entry.role === "writer")).toHaveLength(2);
    expect(usage.every((entry) => entry.input > 0 && entry.costUsd >= 0)).toBe(true);
    expect(result.review.round).toBe(2);
    expect(visibleBullets(result.resume).some((bullet) => bullet.claims.includes(unused))).toBe(true);
    spy.mockClear();
    // Every remaining claim is already used: no extra writer call despite low fill.
    candidate.claimIds = visibleBullets(resume).flatMap((bullet) => bullet.claims);
    const second = await createGenerationRuntime([
      { tool: "submit_resume", arguments: resume },
      { tool: "submit_checks", arguments: { checks: notes(resume) } },
      { tool: "submit_ats", arguments: { ats: [] } },
    ]);
    try {
      if (!second.models) throw new Error("Missing models");
      const shorter = await generate(
        ctx,
        input,
        { runtime: second.runtime, models: second.models, retry: { enabled: false } },
        [],
        await loadProfile(root),
      );
      expect(shorter.review.done).toBe(true);
      expect(spy.mock.calls.filter(([opts]) => opts.role.name === "writer")).toHaveLength(1);
    } finally {
      await second.close();
    }
  } finally {
    await faux.close();
  }
});
