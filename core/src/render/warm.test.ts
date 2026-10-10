import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { warmTemplateCache } from "./warm";

let dir: string;
let templates: string;
let capture: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-warm-test-"));
  templates = join(dir, "templates");
  capture = join(dir, "calls.jsonl");
  await cp(new URL("../../../templates/rover-base/", import.meta.url), join(templates, "rover-base"), {
    recursive: true,
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

async function engine(body: string): Promise<void> {
  const binary = join(dir, "tectonic");
  await writeFile(
    binary,
    `#!${process.execPath}\nconst fs = require("node:fs");\n` +
      `fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), tex: fs.readFileSync("main.tex", "utf8") }) + "\\n");\n${body}`,
  );
  await chmod(binary, 0o755);
  vi.stubEnv("PATH", dir);
}

it("compiles every bundled template once with a sample and network-enabled flags, then cleans temp copies", async () => {
  await cp(new URL("../../../templates/", import.meta.url), templates, { recursive: true });
  await cp(join(templates, "rover-base"), join(templates, "other"), { recursive: true });
  const metadata = join(templates, "other/template.yaml");
  await writeFile(metadata, (await readFile(metadata, "utf8")).replace("id: rover-base", "id: other"));
  await mkdir(join(templates, "other/assets"));
  await writeFile(join(templates, "other/assets/note.txt"), "trusted asset");
  await engine('fs.writeFileSync("main.pdf", "%PDF-test");');
  await warmTemplateCache(templates);
  const calls = (await readFile(capture, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const resumeTemplates = [];
  for (const id of await readdir(templates))
    if (!(await readFile(join(templates, id, "template.yaml"), "utf8")).includes("kind: letter"))
      resumeTemplates.push(id);
  expect(calls).toHaveLength(resumeTemplates.length);
  for (const call of calls) {
    expect(call.args).toEqual(["-X", "compile", "main.tex"]);
    expect(call.tex).toContain("Alex Example");
    expect(call.tex).toContain("Organised records");
    expect(call.tex).toContain("\\textbf{Coordination}");
    expect(call.tex).toContain("Documented clear notes");
    await expect(stat(call.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

it("cleans up when a trusted compile fails and does not accept an old preview PDF", async () => {
  await writeFile(join(templates, "rover-base/main.pdf"), "%PDF-old");
  await engine('console.error("compile failed"); process.exit(1);');
  await expect(warmTemplateCache(templates)).rejects.toThrow();
  const call = JSON.parse((await readFile(capture, "utf8")).trim());
  await expect(stat(call.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  await engine("");
  await expect(warmTemplateCache(templates)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects symlink assets before starting the trusted compiler", async () => {
  await symlink(capture, join(templates, "rover-base/linked.txt"));
  await engine('fs.writeFileSync("main.pdf", "%PDF-test");');
  await expect(warmTemplateCache(templates)).rejects.toThrow("symlink");
  await expect(stat(capture)).rejects.toMatchObject({ code: "ENOENT" });
});
