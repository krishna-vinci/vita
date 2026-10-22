import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume, visibleBullets } from "@vita/shared";
import { expect, it, vi } from "vitest";
import { comparison, type EvaluationCase, evaluate, main } from "../../../scripts/eval/run.js";
import * as agent from "../agent/index.js";
import * as render from "../render/index.js";

import { citeFixtureSummary, skipFixtureResults } from "./test-fixtures.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
it("runs both fixture workspaces in faux mode, records outcomes and usage, writes JSON/comparison without source changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vita-eval-smoke-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const cases: EvaluationCase[] = JSON.parse(await readFile(join(bundledDir, "scripts/eval/cases.json"), "utf8"));
    for (const entry of cases) {
      const source = join(bundledDir, "fixtures", basename(entry.workspace));
      entry.workspace = join(dir, "fixtures", basename(source));
      await cp(source, entry.workspace, { recursive: true });
      await skipFixtureResults(entry.workspace);
      const file = join(entry.workspace, "resumes/master/resume.json");
      await writeFile(file, JSON.stringify(citeFixtureSummary(Resume.parse(JSON.parse(await readFile(file, "utf8"))))));
      entry.job = join(bundledDir, "scripts/eval", entry.job);
    }
    const before = await Promise.all(
      cases.map((entry) => readFile(join(entry.workspace, "resumes/master/resume.json"), "utf8")),
    );
    const text = before
      .map((entry) =>
        visibleBullets(Resume.parse(JSON.parse(entry)))
          .map((bullet) => bullet.text)
          .join("\n"),
      )
      .join("\n");
    vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("faux"), log: "" });
    vi.spyOn(render, "pdfText").mockResolvedValue({ text, pages: 1 });
    const report = await evaluate(cases);
    expect(report.mode).toBe("faux");
    expect(report.results).toHaveLength(4);
    for (const row of report.results) {
      expect(row).toMatchObject({
        done: true,
        rounds: 1,
        lint: expect.any(Number),
        checker: { overstated: 0, unsupported: 0 },
        ats: 0,
        gaps: [],
      });
      expect(
        row.usage.every(
          (entry) =>
            entry.model.startsWith("faux/") &&
            entry.input > 0 &&
            entry.output > 0 &&
            entry.costUsd === 0 &&
            (entry.wallMs ?? -1) >= 0 &&
            entry.cacheRead === 0 &&
            entry.cacheWrite === 0,
        ),
      ).toBe(true);
    }
    expect(comparison(report, report)).toContain("done true → true");
    const after = await Promise.all(
      cases.map((entry) => readFile(join(entry.workspace, "resumes/master/resume.json"), "utf8")),
    );
    expect(after).toEqual(before);
    await main(["--cases", join(bundledDir, "scripts/eval/cases.json"), "--output", join(dir, "run.json")]);
    await main([
      "--compare",
      "--before",
      join(dir, "run.json"),
      "--after",
      join(dir, "run.json"),
      "--output",
      join(dir, "comparison.md"),
    ]);
    expect(await readFile(join(dir, "comparison.md"), "utf8")).toContain("faux/checker");
    await expect(main(["--cases"])).rejects.toThrow("Usage");
    vi.spyOn(agent, "runRole").mockRejectedValue(new Error("Scripted provider failure"));
    const failed = await evaluate(cases.slice(0, 1));
    expect(failed.results).toHaveLength(2);
    expect(
      failed.results.every((row) => !row.done && row.error === "Scripted provider failure" && row.checker === null),
    ).toBe(true);
  } finally {
    vi.restoreAllMocks();
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);
