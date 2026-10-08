import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { compileOriginal, warmUploadedPackages } from "./compile.js";
import { receiveTemplateUpload } from "./storage.js";

let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});
it("warms only bundle packages from usepackage lines with a clean generated stub, then compiles the upload untrusted and offline", async () => {
  root = await mkdtemp(join(tmpdir(), "vita-warm-test-"));
  const capture = join(root, "calls.jsonl");
  const binary = join(root, "tectonic");
  await writeFile(
    binary,
    `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ args, cwd: process.cwd(), files: fs.readdirSync('.'), tex: fs.existsSync('main.tex') ? fs.readFileSync('main.tex', 'utf8') : null }) + '\\n'); if (args.includes('cat')) { if (args.at(-1) === 'microtype.sty') console.log('trusted package'); else { console.error('error: not found'); process.exit(1); } } else { fs.writeFileSync('main.pdf', '%PDF-test'); }`,
  );
  await chmod(binary, 0o755);
  vi.stubEnv("PATH", root);
  const tex =
    "\\documentclass{article}\n\\usepackage[draft]{microtype,local}\n\\newcommand{\\sample}{UNTRUSTED SAMPLE}\n\\begin{document}PERSONAL SAMPLE\\end{document}";
  const upload = await receiveTemplateUpload(root, { filename: "cv.tex", bytes: Buffer.from(tex) });
  expect((await compileOriginal(upload)).pdf.toString()).toBe("%PDF-test");
  const calls = (await readFile(capture, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const warm = calls.find((call) => call.args.includes("compile") && !call.args.includes("--untrusted"));
  expect(warm.tex).toContain("\\usepackage{microtype}");
  expect(warm.tex).not.toMatch(/local|draft|PERSONAL|UNTRUSTED/);
  expect(warm.files).toEqual(["main.tex"]);
  const original = calls.at(-1);
  expect(original.args).toEqual(["-X", "compile", "--untrusted", "--only-cached", "main.tex"]);
  expect(original.tex).toBe(tex);
  for (const call of calls) await expect(stat(call.cwd)).rejects.toMatchObject({ code: "ENOENT" });
});
it("does not warm unsafe commands or accept package-name injection", async () => {
  await expect(warmUploadedPackages("\\write18{bad}\\usepackage{microtype}")).rejects.toThrow("Unsafe LaTeX input");
  // No validated package names means no subprocess is run.
  await warmUploadedPackages("\\documentclass{article}\\usepackage{../local}");
});
