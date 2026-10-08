import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vita/core";
import { Profile, Resume } from "@vita/shared";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { printReview } from "./commands/master";
import { checkCommand, createProgram, importCommand, initCommand, renderCommand, setupCommand } from "./index";
import { bundledTemplatesDir } from "./paths";

const fixtures = fileURLToPath(new URL("../../fixtures/", import.meta.url));
const profiles = ["developer", "nurse", "teacher", "accountant"];
let dir: string;
let available = false;
beforeAll(async () => {
  available = await core.tectonicAvailable();
  if (!available) console.warn("Skipping fixture render tests: tectonic is not on PATH.");
});
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-cli-test-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_COUNT", "2");
  vi.stubEnv("GIT_CONFIG_KEY_0", "user.name");
  vi.stubEnv("GIT_CONFIG_VALUE_0", "Vita Test");
  vi.stubEnv("GIT_CONFIG_KEY_1", "user.email");
  vi.stubEnv("GIT_CONFIG_VALUE_1", "test@vita.local");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function copyProfile(profile: string): Promise<string> {
  const root = join(dir, profile);
  await cp(join(fixtures, profile), root, { recursive: true });
  return root;
}

it("initialises a named workspace and refuses to replace it", async () => {
  const root = join(dir, "workspace");
  await initCommand(root, { name: "Alex Example" });
  expect(await readFile(join(root, "outline.md"), "utf8")).toContain("# Alex Example");
  expect((await core.log(root, 10)).map((entry) => entry.author)).toEqual(["system"]);
  await expect(initCommand(root)).rejects.toThrow("already has outline.md");
});

it("imports legacy evidence and an outline losslessly, adds anchors, prints the report and commits as importer", async () => {
  const root = join(dir, "workspace");
  await initCommand(root);
  const source = fileURLToPath(new URL("../../core/src/source/fixtures/legacy-projects.md", import.meta.url));
  const outline = join(dir, "legacy-outline.md");
  const text =
    "# Alex Example\r\n\r\n## Experience\r\n- Kept accurate records.\r\n\r\nUnstructured notes stay here.\r\n";
  await writeFile(outline, text);
  const report = await importCommand(root, { projects: source, outline });
  expect(report.some((line) => line.includes("evidence row"))).toBe(true);
  expect(console.log).toHaveBeenCalledWith("Added 1 outline anchors.");
  const imported = await readFile(join(root, "projects.md"), "utf8");
  expect(core.parseProjects(imported).issues).toEqual([]);
  expect(core.parseProjects(imported).doc.items).toHaveLength(2);
  const anchored = await readFile(join(root, "outline.md"), "utf8");
  expect(anchored.replace(/ <!-- c:[^>]+ -->/g, "")).toBe(text);
  expect((await core.log(root, 10))[0]?.author).toBe("importer");
  await importCommand(root, { projects: source });
  expect(await readFile(join(root, "outline.md"), "utf8")).toBe(anchored);
  expect(await core.log(root, 10)).toHaveLength(2);
});

it.each(profiles)("checks the %s fixture with every bullet backed by inventory claims", async (profile) => {
  const root = await copyProfile(profile);
  expect(await checkCommand(root)).toEqual({ ok: true, issues: [] });
  const inventory = core.parseProjects(await core.readText(root, "projects.md"));
  const claims = new Set(inventory.doc.items.flatMap((item) => item.claims.map((claim) => claim.id)));
  const resume = Resume.parse(JSON.parse(await core.readText(root, "resumes/master/resume.json")));
  for (const section of resume.sections)
    for (const item of section.items)
      for (const bullet of item.bullets) {
        expect(bullet.claims.length).toBeGreaterThan(0);
        for (const claim of bullet.claims) expect(claims.has(claim)).toBe(true);
      }
});

it("reports bad schemas, unknown and empty claims, but permits anchored outline facts and free prose", async () => {
  const root = await copyProfile("developer");
  const resumeFile = join(root, "resumes/master/resume.json");
  const resume = JSON.parse(await readFile(resumeFile, "utf8"));
  const bullets = resume.sections[1].items[0].bullets;
  bullets[0].claims = ["missing-fact"];
  bullets[1].claims = [];
  bullets[2].claims = ["outline-fact"];
  await writeFile(join(root, "outline.md"), "Free prose\n## Any title\n- Recorded a fact. <!-- c:outline-fact -->\n");
  await writeFile(resumeFile, JSON.stringify(resume));
  expect(await checkCommand(root)).toEqual({
    ok: false,
    issues: ["Bullet work-bullet-1: unknown claim missing-fact", "Bullet work-bullet-2: no claim IDs"],
  });
  await writeFile(join(root, "projects.md"), "## Item\n```yaml\nlinks: 3\n```\n");
  await writeFile(resumeFile, "{}");
  const result = await checkCommand(root);
  expect(result.ok).toBe(false);
  expect(result.issues.some((issue) => issue.startsWith("projects.md:2:"))).toBe(true);
  expect(result.issues.some((issue) => issue.startsWith("resumes/master/resume.json:"))).toBe(true);
});

it("registers all commands and sets the CLI failure status when check finds issues", async () => {
  const program = createProgram();
  expect(program.commands.map((command) => command.name())).toEqual([
    "init",
    "import",
    "render",
    "check",
    "setup",
    "master",
    "tailor",
  ]);
  const root = await copyProfile("developer");
  await writeFile(join(root, "resumes/master/resume.json"), "{}");
  const previous = process.exitCode;
  try {
    await program.parseAsync(["check", root], { from: "user" });
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
  }
});

it("setup warms only bundled templates", async () => {
  const warm = vi.spyOn(core, "warmTemplateCache").mockResolvedValue();
  await setupCommand();
  expect(warm).toHaveBeenCalledExactlyOnceWith(bundledTemplatesDir);
});

for (const profile of profiles) {
  it(`renders the ${profile} fixture to a checked one-page PDF, Markdown and TeX`, async (context) => {
    if (!available) context.skip();
    const root = await copyProfile(profile);
    const out = profile === "nurse" ? join(dir, "export") : undefined;
    const result = await renderCommand(root, { out });
    expect(result).toEqual({ ok: true, pages: 1, maxPages: 1, missingBullets: [], outOfOrder: [] });
    const output = out ?? join(root, "resumes/master");
    expect((await readFile(join(output, "resume.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await readFile(join(output, "resume.md"), "utf8")).toMatch(/^# /);
    expect(await readFile(join(output, "resume.tex"), "utf8")).toContain("\\begin{document}");
  }, 60_000);
}

it("rejects escaping output symlinks and leaves the last good PDF intact on compile failure", async () => {
  const root = await copyProfile("developer");
  const output = join(root, "resumes/master");
  await writeFile(join(output, "resume.pdf"), "%PDF-last-good");
  const compile = vi.spyOn(core, "compileTex").mockRejectedValue(new Error("compile failed"));
  await expect(renderCommand(root)).rejects.toThrow("compile failed");
  expect(await readFile(join(output, "resume.pdf"), "utf8")).toBe("%PDF-last-good");
  compile.mockResolvedValue({ pdf: Buffer.from("%PDF-test"), log: "" });
  vi.spyOn(core, "pdfText").mockResolvedValue({ text: "", pages: 1 });
  const outside = join(dir, "outside.tex");
  await writeFile(outside, "keep");
  await symlink(outside, join(output, "resume.tex"));
  await expect(renderCommand(root)).rejects.toThrow("escapes");
  expect(await readFile(outside, "utf8")).toBe("keep");
  const previous = process.exitCode;
  try {
    await rm(join(output, "resume.tex"));
    await createProgram().parseAsync(["render", root], { from: "user" });
    expect(process.exitCode).toBe(1);
  } finally {
    process.exitCode = previous;
  }
});

it("creates and updates a profile through repeatable import flags, preserving unspecified fields", async () => {
  const root = join(dir, "workspace");
  await initCommand(root);
  await rm(join(root, "profile.yaml"));
  const source = fileURLToPath(new URL("../../core/src/source/fixtures/legacy-projects.md", import.meta.url));
  await createProgram().parseAsync(
    [
      "import",
      root,
      "--projects",
      source,
      "--name",
      "Alex Example",
      "--headline",
      "Coordinator",
      "--contact",
      "Email=alex@example.test",
      "--contact",
      "Web=Portfolio=https://example.test/?a=b",
    ],
    { from: "user" },
  );
  expect(Profile.parse(parseYaml(await core.readText(root, "profile.yaml")))).toEqual({
    name: "Alex Example",
    headline: "Coordinator",
    contact: [
      { label: "Email", value: "alex@example.test" },
      { label: "Web", value: "Portfolio", url: "https://example.test/?a=b" },
    ],
  });
  await importCommand(root, { projects: source, headline: "Updated" });
  const updated = Profile.parse(parseYaml(await core.readText(root, "profile.yaml")));
  expect(updated.name).toBe("Alex Example");
  expect(updated.headline).toBe("Updated");
  expect(updated.contact).toHaveLength(2);
  const before = await core.readText(root, "profile.yaml");
  await expect(importCommand(root, { projects: source, contact: ["Invalid"] })).rejects.toThrow("Label=value");
  expect(await core.readText(root, "profile.yaml")).toBe(before);
  expect((await core.log(root, 1))[0]?.author).toBe("importer");
});

it("prints plain-language gap questions with their requirement ids", () => {
  printReview({
    round: 1,
    done: false,
    blocking: [],
    lint: [],
    checks: [],
    ats: [],
    render: null,
    overrides: [],
    gaps: [
      "req-short: Have you used Example skill?",
      "req-long: Do you have experience with leading a team across multiple locations?",
    ],
  });
  expect(console.log).toHaveBeenCalledWith("Gap: req-short: Have you used Example skill?");
  expect(console.log).toHaveBeenCalledWith(
    "Gap: req-long: Do you have experience with leading a team across multiple locations?",
  );
});
