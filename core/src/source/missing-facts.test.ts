import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureRepo, readText, writeTextAtomic } from "../workspace/index.js";
import { answerMissingFacts, missingFacts } from "./missing-facts.js";
import { parseProjects } from "./projects.js";

let root: string;
const source =
  "# Evidence\n\n## Example\n\n```yaml\nkind: project\n# retain me\nlinks: []\n```\n\n### Claims\n- Built a useful service. <!-- c:example -->\n\n### Notes\nKeep these bytes.\n";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-facts-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await ensureRepo(root);
  await writeTextAtomic(root, "projects.md", source);
  await writeTextAtomic(
    root,
    "outline.md",
    "# Profile\n\n## Education\n\n### Example Degree | Example College\nKeep this prose.\n\n## Experience\n\n### Example Role\n- Managed the service. <!-- c:role -->\n",
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
it("detects stable ids and writes period, education year and statement results without changing other bytes", async () => {
  const questions = await missingFacts(root);
  expect(questions.map((q) => q.id)).toEqual([
    "dates.example",
    "dates.example-role",
    "results.example",
    "graduation.example-degree",
  ]);
  await answerMissingFacts(root, { "dates.example": "2021 – 2024" });
  expect(await readText(root, "projects.md")).toBe(source.replace("links: []\n", "links: []\nperiod: 2021 – 2024\n"));
  await answerMissingFacts(
    root,
    {
      "dates.example-role": "2022 – 2024",
      "graduation.example-degree": "2025",
      "results.example": "Used by forty people each week",
    },
    new Date("2026-10-22"),
  );
  const text = await readText(root, "projects.md");
  expect(text).toContain("# retain me\nlinks: []\nperiod: 2021 – 2024\n");
  expect(text).toContain("### Notes\nKeep these bytes.\n");
  expect(await readText(root, "outline.md")).toContain("### Example Degree | Example College | 2025\nKeep this prose.");
  const item = parseProjects(text).doc.items[0];
  expect(item?.claims.some((claim) => claim.text === "Used by forty people each week")).toBe(true);
  expect(item?.meta.evidence[0]).toMatchObject({
    kind: "statement",
    text: "Used by forty people each week",
    at: "2026-10-22",
  });
  expect(await readText(root, "outline.md")).toContain(
    "### Example Role | 2022 – 2024\n- Managed the service. <!-- c:role -->",
  );
  expect((await missingFacts(root)).map((q) => q.id)).toEqual([]);
});
it("remembers skipped project and outline facts across reads", async () => {
  await answerMissingFacts(root, {
    "dates.example": "skip",
    "results.example": "skip",
    "dates.example-role": "skip",
    "graduation.example-degree": "skip",
  });
  expect(parseProjects(await readText(root, "projects.md")).doc.items[0]?.meta.skipped).toEqual(["dates", "results"]);
  expect(await missingFacts(root)).toEqual([]);
});
it("recognizes result claims only with metrics or relevant statement/measurement receipts", async () => {
  await writeTextAtomic(
    root,
    "projects.md",
    source
      .replace(
        "links: []",
        "links: []\nperiod: '2024'\nevidence:\n  - id: ev-result\n    kind: statement\n    text: All tests passed under the expected workload",
      )
      .replace(
        "Built a useful service. <!-- c:example -->",
        "Verified workload handling. <!-- c:example ev:ev-result -->",
      ),
  );
  expect((await missingFacts(root)).some((question) => question.id === "results.example")).toBe(false);
});
