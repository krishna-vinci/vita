import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { loadPack, resolvePack, resolvePacks } from "./index";

const bundled = fileURLToPath(new URL("../../../packs/", import.meta.url));
const ids = [
  "it-core",
  "devops-sre",
  "cloud",
  "backend",
  "frontend",
  "fullstack",
  "data",
  "ml-ai",
  "security",
  "qa",
  "mobile",
  "it-support",
  "embedded",
];

function groupHeads(pack: { keywords: string[][] }): string[] {
  return pack.keywords.map((group) => (group[0] ?? "").toLowerCase());
}

it("bundles IT packs with the required fields and a valid extends chain", async () => {
  for (const id of ids) {
    const pack = await loadPack([bundled], id);
    expect(pack.name.length).toBeGreaterThan(0);
    expect(pack.extends).toBe(id === "it-core" ? "general" : "it-core");
    expect(pack.keywords.length).toBeGreaterThanOrEqual(15);
    expect(pack.keywords.length).toBeLessThanOrEqual(40);
    expect(pack.metric_questions.length).toBeGreaterThanOrEqual(6);
    expect(pack.metric_questions.length).toBeLessThanOrEqual(10);
    expect(pack.section_order.length).toBeGreaterThan(0);
    expect(pack.verbs.length).toBeGreaterThanOrEqual(15);
    expect(pack.verbs.length).toBeLessThanOrEqual(30);
    expect(pack.banned_phrases.length).toBeGreaterThan(0);
    expect(pack.interview_topics.length).toBeGreaterThanOrEqual(8);
    expect(pack.interview_topics.length).toBeLessThanOrEqual(15);
    for (const group of pack.keywords) expect(group.length).toBeGreaterThan(1);

    const resolved = await resolvePack([bundled], id);
    expect(resolved.verbs).toEqual(expect.arrayContaining(["Organised", ...pack.verbs]));
    expect(resolved.keywords).toEqual(expect.arrayContaining(pack.keywords));
    expect(resolved.metric_questions).toEqual(expect.arrayContaining(pack.metric_questions));
    expect(resolved.banned_phrases).toEqual(expect.arrayContaining(pack.banned_phrases));
  }
});

it("has no duplicate keyword group head inside a bundled pack chain", async () => {
  for (const id of ids) {
    const heads = groupHeads(await resolvePack([bundled], id));
    expect(new Set(heads).size).toBe(heads.length);
  }
});

it("merges several profession packs into one effective pack without dropping either chain", async () => {
  const merged = await resolvePacks([bundled], ["devops-sre", "backend"]);
  expect(merged.id).toBe("effective");
  expect(merged.extends).toBeUndefined();
  const anyGroup = (term: string) => merged.keywords.some((group) => group.includes(term));
  expect(anyGroup("Kubernetes")).toBe(true);
  expect(anyGroup("Node.js")).toBe(true);
  expect(merged.verbs).toEqual(expect.arrayContaining(["Organised", "Orchestrated", "Engineered"]));
  expect(merged.metric_questions).toEqual(
    expect.arrayContaining(["How many incidents or pages per month did you reduce?"]),
  );
});
