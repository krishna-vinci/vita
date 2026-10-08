import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRepo, readText, tectonicAvailable } from "@vita/core";
import { Resume, visibleBullets } from "@vita/shared";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createProgram } from "./index";

const repo = fileURLToPath(new URL("../../", import.meta.url));
let dir: string;
let available: boolean;
beforeAll(async () => {
  available = await tectonicAvailable();
  if (!available) console.warn("Skipping generation CLI PDF tests: Tectonic is not on PATH.");
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-generation-cli-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(dir, "agent"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function fixture(profile: string) {
  const root = join(dir, "workspace");
  await cp(join(repo, "fixtures", profile), root, { recursive: true });
  await ensureRepo(root);
  const resume = Resume.parse(JSON.parse(await readText(root, "resumes/master/resume.json")));
  return { root, resume };
}

function draft(resume: Resume, unsupported = false) {
  return [
    { tool: "submit_resume", arguments: resume },
    {
      tool: "submit_checks",
      arguments: {
        checks: visibleBullets(resume).map((bullet) => ({
          bulletId: bullet.id,
          verdict: unsupported ? "unsupported" : "supported",
          reason: "Source compared",
        })),
      },
    },
  ];
}

async function scriptFile(script: unknown) {
  const file = join(dir, "script.json");
  await writeFile(file, JSON.stringify(script));
  return file;
}

function cli(args: string[], stdin = ""): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["vita", ...args], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("CLI generation timed out"));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
    child.stdin.end(stdin);
  });
}

it("runs pnpm vita master with a hidden faux script and prints the successful review", async (test) => {
  if (!available) return test.skip();
  const { root, resume } = await fixture("teacher");
  const result = await cli(["master", root, "--faux", await scriptFile(draft(resume))]);
  expect(result.code).toBe(0);
  expect(result.output).toContain("write [1]");
  expect(result.output).toContain("Review: done (round 1)");
  expect((await readFile(join(root, "resumes/master/resume.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
  const command = createProgram().commands.find((entry) => entry.name() === "master");
  expect(command?.helpInformation()).not.toContain("--faux");
}, 60_000);

for (const source of ["file", "stdin"]) {
  it(`runs pnpm vita tailor reading the job from ${source}`, async (test) => {
    if (!available) return test.skip();
    const { root, resume } = await fixture("developer");
    const job = "Build a catalogue service.";
    const file = join(dir, "job.md");
    await writeFile(file, job);
    const script = await scriptFile([
      {
        tool: "submit_analysis",
        arguments: {
          title: "Coordinator",
          requirements: [{ id: "req-a", text: "Catalogue", importance: "must", keywords: [["catalogue"]] }],
          baseScores: [],
        },
      },
      ...draft(resume),
      { tool: "submit_ats", arguments: { ats: [] } },
    ]);
    const result = await cli(
      ["tailor", root, "--job", source === "stdin" ? "-" : file, "--slug", "cli-test", "--faux", script],
      source === "stdin" ? job : "",
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("Review: done");
    const relative = /Application: (applications\/\d{4}-\d{2}-\d{2}-cli-test)/.exec(result.output)?.[1];
    expect(relative).toBeDefined();
    if (!relative) throw new Error("Missing CLI application path");
    expect(await readFile(join(root, relative, "job.md"), "utf8")).toBe(job);
    expect(JSON.parse(await readFile(join(root, relative, "review.json"), "utf8")).done).toBe(true);
  }, 60_000);
}

it("returns a failure status and blocking summary when the checker rejects both rounds", async (test) => {
  if (!available) return test.skip();
  const { root, resume } = await fixture("teacher");
  const result = await cli([
    "master",
    root,
    "--faux",
    await scriptFile([...draft(resume, true), ...draft(resume, true)]),
  ]);
  expect(result.code).toBe(1);
  expect(result.output).toContain("Review: not done (round 2)");
  expect(result.output).toContain("Blocking: unsupported:");
}, 60_000);
