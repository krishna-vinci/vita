import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { loadPack, resolvePack, resolvePacks } from "./index";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-packs-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function pack(root: string, id: string, fields: string): Promise<void> {
  await mkdir(join(root, id), { recursive: true });
  await writeFile(join(root, id, "pack.yaml"), `id: ${id}\nname: ${id}\n${fields}`);
}

it("follows an extends chain with parent-first case-insensitive deduplication of every list", async () => {
  await pack(
    dir,
    "root",
    "verbs: [Built, BUILT]\nkeywords: [[Records, records, Archives]]\nmetric_questions: [Volume]\nsection_order: [Summary]\nbanned_phrases: [synergy]\ninterview_topics: [teamwork]\n",
  );
  await pack(
    dir,
    "middle",
    "extends: root\nverbs: [built, Led]\nkeywords: [[records, archives], [Review, Audit]]\nmetric_questions: [volume, Time]\nsection_order: [summary, Experience]\nbanned_phrases: [SYNERGY, seamless]\ninterview_topics: [Teamwork, motivation]\n",
  );
  await pack(dir, "leaf", "extends: middle\nverbs: [LED, Prepared]\n");
  expect(await resolvePack([dir], "leaf")).toEqual({
    id: "leaf",
    name: "leaf",
    extends: "middle",
    verbs: ["Built", "Led", "Prepared"],
    keywords: [
      ["Records", "Archives"],
      ["Review", "Audit"],
    ],
    metric_questions: ["Volume", "Time"],
    section_order: ["Summary", "Experience"],
    banned_phrases: ["synergy", "seamless"],
    interview_topics: ["teamwork", "motivation"],
  });
  const combined = await resolvePacks([dir], ["middle", "leaf"]);
  expect(combined.id).toBe("effective");
  expect(combined.name).toBe("leaf");
  expect(combined.verbs).toEqual(["Built", "Led", "Prepared"]);
  expect(combined.extends).toBeUndefined();
  expect((await resolvePacks([dir], [])).id).toBe("effective");
});

it("prefers workspace packs and rejects invalid metadata, missing packs, traversal and escaping symlinks", async () => {
  const roots = [join(dir, "workspace"), join(dir, "bundled")];
  await pack(roots[0] ?? "", "example", "verbs: [Prepared]\n");
  await pack(roots[1] ?? "", "example", "verbs: [Built]\n");
  expect((await loadPack(roots, "example")).verbs).toEqual(["Prepared"]);
  expect((await loadPack([join(dir, "missing"), roots[1] ?? ""], "example")).verbs).toEqual(["Built"]);
  await expect(loadPack(roots, "missing")).rejects.toThrow("not found");
  await expect(loadPack(roots, "../example")).rejects.toThrow();
  const metadata = join(roots[0] ?? "", "example/pack.yaml");
  await writeFile(metadata, "id: other\nname: Wrong\n");
  await expect(loadPack(roots, "example")).rejects.toThrow("mismatch");
  await writeFile(metadata, "id: example\nname: Wrong\nverbs: 3\n");
  await expect(loadPack(roots, "example")).rejects.toThrow();
  await rm(metadata);
  await symlink(join(roots[1] ?? "", "example/pack.yaml"), metadata);
  await expect(loadPack(roots, "example")).rejects.toThrow("escapes");
});

it("reports cycles and missing parents without recursing forever", async () => {
  await pack(dir, "a", "extends: b\n");
  await pack(dir, "b", "extends: a\n");
  await expect(resolvePack([dir], "a")).rejects.toThrow("a -> b -> a");
  await pack(dir, "a", "extends: absent\n");
  await expect(resolvePack([dir], "a")).rejects.toThrow("not found: absent");
  await pack(dir, "a", "extends: a\n");
  await expect(resolvePack([dir], "a")).rejects.toThrow("a -> a");
});

it("bundles universal guidance with the required verbs, banned phrases, questions and sections", async () => {
  const general = await resolvePack([fileURLToPath(new URL("../../../packs/", import.meta.url))], "general");
  expect(general.verbs.length).toBeGreaterThanOrEqual(25);
  expect(general.banned_phrases.length).toBeGreaterThanOrEqual(15);
  expect(general.metric_questions).toHaveLength(5);
  expect(general.section_order).toEqual(["Summary", "Experience", "Projects", "Education", "Skills", "Certifications"]);
  expect(general.interview_topics).toHaveLength(5);
});
