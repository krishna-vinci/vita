import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@vita/shared";
import { beforeAll, expect, it } from "vitest";
import { CompileError, compileTex, tectonicAvailable } from "./compile";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";
import { checkRender, pdfText } from "./textcheck";

let available = false;
beforeAll(async () => {
  available = await tectonicAvailable();
  if (!available) console.warn("Skipping render integration tests: tectonic is not on PATH.");
});

it("compiles rover-base and checks extracted bullet text in order on one page", async (context) => {
  if (!available) context.skip();
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const { pdf } = await compileTex({ tex: renderTex(resume, tpl), assetsDir: tpl.dir });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const extracted = await pdfText(pdf);
  expect(checkRender(resume, extracted, 1), extracted.text).toMatchObject({
    pages: 1,
    maxPages: 1,
    missingBullets: [],
    outOfOrder: [],
    ok: true,
  });
}, 60_000);

it("kills a looping TeX process on timeout and produces CompileError", async (context) => {
  if (!available) context.skip();
  const start = Date.now();
  const error = await compileTex({ tex: "\\def\\x{\\x}\\x", timeoutMs: 3000 }).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(CompileError);
  expect(error).toMatchObject({ message: "timeout", log: expect.any(String) });
  expect(Date.now() - start).toBeLessThan(6000);
}, 10_000);

it("rejects unsafe input, included unsafe text assets and symlinks before compiling", async () => {
  await expect(compileTex({ tex: "\\input{/etc/passwd}" })).rejects.toMatchObject({
    name: "CompileError",
    log: expect.stringContaining("main.tex:1"),
  });
  const dir = await mkdtemp(join(tmpdir(), "vita-assets-test-"));
  try {
    await mkdir(join(dir, "assets"));
    await writeFile(join(dir, "assets/local.txt"), "\\write18{unsafe}");
    await expect(compileTex({ tex: "\\input{local.txt}", assetsDir: join(dir, "assets") })).rejects.toThrow("Unsafe");
    await rm(join(dir, "assets/local.txt"));
    await writeFile(join(dir, "outside.txt"), "outside");
    await symlink(join(dir, "outside.txt"), join(dir, "assets/linked.txt"));
    await expect(compileTex({ tex: "safe", assetsDir: join(dir, "assets") })).rejects.toThrow("symlink");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("compiles rover-base with an empty headline and contact list", async (context) => {
  if (!available) context.skip();
  const resume = Resume.parse(
    JSON.parse(await readFile(new URL("./fixtures/resume-basic.json", import.meta.url), "utf8")),
  );
  resume.header = { name: "Alex Example", headline: "", contact: [] };
  const tpl = await loadTemplate([fileURLToPath(new URL("../../../templates", import.meta.url))], "rover-base");
  const tex = renderTex(resume, tpl);
  expect(tex).not.toContain("\\raggedleft");
  expect(tex).not.toContain("\\\\ \\medskip");
  const { pdf } = await compileTex({ tex, assetsDir: tpl.dir });
  expect(checkRender(resume, await pdfText(pdf), 1).ok).toBe(true);
}, 60_000);
