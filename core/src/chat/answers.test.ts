import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { parseOutline, parseProjects } from "../source/index.js";
import { ensureRepo, fileHash, readText, writeTextAtomic } from "../workspace/index.js";
import { proposeAnswerPromotion } from "./answers.js";
import { applySourceEdit } from "./source.js";

let root: string;
const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
const id = "example";
const ws = () => ({ root, bundledDir });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-answers-promote-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await cp(join(bundledDir, "fixtures/developer"), root, { recursive: true });
  await writeTextAtomic(
    root,
    `applications/${id}/meta.yaml`,
    'createdAt: "2026-10-09"\nanswers:\n  req-recovery: "Yes, added recovery messages."\n  req-management: "No"\n',
  );
  await writeTextAtomic(
    root,
    `applications/${id}/analysis.json`,
    JSON.stringify({
      title: "Maintainer",
      company: "Example",
      requirements: [{ id: "req-recovery", text: "Recovery", importance: "must", keywords: [["Recovery"]] }],
      baseScores: [],
    }),
  );
  await ensureRepo(root);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("promotes only yes answers as dated statements through an approval diff with stable answer claim IDs", async () => {
  const before = await readText(root, "projects.md");
  const hash = await fileHash(root, "projects.md");
  const proposal = await proposeAnswerPromotion(ws(), id, {}, new Date("2026-10-10T00:00:00Z"));
  expect(proposal.baseHash).toBe(hash);
  expect(await readText(root, "projects.md")).toBe(before);
  expect(proposal.after.startsWith(before)).toBe(true);
  const saved = await applySourceEdit(ws(), proposal);
  expect(saved.sha).toMatch(/^[a-f0-9]{40}$/);
  const projects = parseProjects(await readText(root, "projects.md"));
  expect(projects.issues).toEqual([]);
  const claims = buildClaimIndex(projects.doc, parseOutline(""));
  expect(claims.claims.get("answer.example.req-recovery")).toMatchObject({
    text: expect.stringContaining("added recovery messages"),
    evidence: [expect.objectContaining({ kind: "statement", at: "2026-10-10", text: "Yes, added recovery messages." })],
  });
  expect(claims.claims.has("answer.example.req-management")).toBe(false);
  await expect(proposeAnswerPromotion(ws(), id)).rejects.toThrow("already been promoted");
});
it("refuses no-answer selections, invalid IDs and stale source proposals", async () => {
  await expect(proposeAnswerPromotion(ws(), id, { requirementIds: ["req-management"] })).rejects.toThrow(
    "No yes answers",
  );
  await expect(proposeAnswerPromotion(ws(), "../outside")).rejects.toThrow();
  const proposal = await proposeAnswerPromotion(ws(), id);
  await writeTextAtomic(root, "projects.md", `${await readText(root, "projects.md")}\nUser wrote new text.\n`);
  await expect(applySourceEdit(ws(), proposal)).rejects.toMatchObject({ code: "stale-hash" });
});
