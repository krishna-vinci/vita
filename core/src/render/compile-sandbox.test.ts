import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { compileTex } from "./compile";

// A local fake binary exercises process limits without producing huge real PDFs.
async function withEngine(body: string, run: (dir: string, capture: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "vita-engine-test-"));
  const capture = join(dir, "invocation.json");
  try {
    const binary = join(dir, "tectonic");
    await writeFile(
      binary,
      `#!${process.execPath}\nconst fs = require("node:fs");\n` +
        `fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n` +
        body,
    );
    await chmod(binary, 0o755);
    vi.stubEnv("PATH", dir);
    await run(dir, capture);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}

it("runs untrusted and offline in a fresh directory, copies nested assets and cleans up on success", async () => {
  await withEngine(
    'fs.writeFileSync("main.pdf", fs.readFileSync("nested/asset.txt")); console.log("compiled");',
    async (dir, capture) => {
      const assets = join(dir, "assets");
      await mkdir(join(assets, "nested"), { recursive: true });
      await writeFile(join(assets, "nested/asset.txt"), "%PDF-test");
      const result = await compileTex({ tex: "safe", assetsDir: assets });
      expect(result.pdf.toString()).toBe("%PDF-test");
      expect(result.log).toContain("compiled");
      const invocation = JSON.parse(await readFile(capture, "utf8"));
      expect(invocation.args).toEqual(["-X", "compile", "--untrusted", "--only-cached", "main.tex"]);
      expect(invocation.cwd).not.toBe(assets);
      await expect(stat(invocation.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});

it("rejects output over 20 MB and cleans up on failure", async () => {
  await withEngine('fs.writeFileSync("main.pdf", Buffer.alloc(20 * 1024 * 1024 + 1));', async (_dir, capture) => {
    await expect(compileTex({ tex: "safe" })).rejects.toMatchObject({
      name: "CompileError",
      message: "output exceeds 20 MB",
    });
    const invocation = JSON.parse(await readFile(capture, "utf8"));
    await expect(stat(invocation.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("requires newly generated output and scans text assets containing NUL bytes", async () => {
  await withEngine("", async (dir, capture) => {
    const assets = join(dir, "assets");
    await mkdir(assets);
    await writeFile(join(assets, "main.pdf"), "%PDF-old");
    await expect(compileTex({ tex: "safe", assetsDir: assets })).rejects.toMatchObject({ name: "CompileError" });
    const invocation = JSON.parse(await readFile(capture, "utf8"));
    await expect(stat(invocation.cwd)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(assets, "included.txt"), "\0\\input{../outside}");
    await expect(compileTex({ tex: "safe", assetsDir: assets })).rejects.toThrow("Unsafe LaTeX input");
  });
});
