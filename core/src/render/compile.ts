import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prescanTex } from "./prescan";

const OUTPUT_CAP = 20 * 1024 * 1024;

export class CompileError extends Error {
  constructor(
    message: string,
    public log: string = "",
  ) {
    super(message);
    this.name = "CompileError";
  }
}

function scan(source: string, name: string): void {
  const issues = prescanTex(source);
  if (issues.length) {
    throw new CompileError(
      "Unsafe LaTeX input",
      issues.map((issue) => `${name}:${issue.line}: ${issue.message}`).join("\n"),
    );
  }
}

async function copyAssets(source: string, destination: string): Promise<void> {
  if (!(await lstat(source)).isDirectory()) throw new CompileError("Assets must be a directory without symlinks");
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to);
      await copyAssets(from, to);
    } else if (entry.isFile()) {
      const file = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await file.stat()).isFile()) throw new CompileError("Assets must be regular files");
        const contents = await file.readFile();
        // Scan text assets too: a locally included file can have any extension.
        const text = contents.toString("utf8");
        if (Buffer.from(text, "utf8").equals(contents) || /\.(tex|sty|cls|ltx|cfg|def|njk)$/i.test(entry.name)) {
          scan(text, entry.name);
        }
        await writeFile(to, contents, { flag: "wx" });
      } finally {
        await file.close();
      }
    } else {
      throw new CompileError(`Non-regular asset or symlink: ${entry.name}`);
    }
  }
}

async function runTectonic(dir: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("tectonic", ["-X", "compile", "--untrusted", "--only-cached", "main.tex"], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    let bytes = 0;
    let failure: string | undefined;
    const stop = (message: string) => {
      failure ??= message;
      child.kill("SIGKILL");
    };
    const capture = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > OUTPUT_CAP) stop("output exceeds 20 MB");
      else log += chunk.toString("utf8");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    const monitor = setInterval(() => {
      void stat(join(dir, "main.pdf"))
        .then((info) => {
          if (info.size + bytes > OUTPUT_CAP) stop("output exceeds 20 MB");
        })
        .catch(() => {});
    }, 50);
    child.on("error", (error) => {
      failure ??= error.message;
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearInterval(monitor);
      if (failure || code !== 0) reject(new CompileError(failure ?? `Tectonic exited with code ${code}`, log));
      else resolve(log);
    });
  });
}

export async function compileTex(opts: {
  tex: string;
  assetsDir?: string;
  timeoutMs?: number;
}): Promise<{ pdf: Buffer; log: string }> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new CompileError("Invalid timeout");
  scan(opts.tex, "main.tex");
  const dir = await mkdtemp(join(tmpdir(), "vita-compile-"));
  let log = "";
  try {
    if (opts.assetsDir) await copyAssets(opts.assetsDir, dir);
    // A copied preview must never be mistaken for this compilation's output.
    await rm(join(dir, "main.pdf"), { force: true });
    await writeFile(join(dir, "main.tex"), opts.tex);
    log = await runTectonic(dir, timeoutMs);
    const output = join(dir, "main.pdf");
    const info = await lstat(output);
    if (!info.isFile() || info.isSymbolicLink()) throw new CompileError("PDF output must be a regular file", log);
    if (info.size + Buffer.byteLength(log) > OUTPUT_CAP) throw new CompileError("output exceeds 20 MB", log);
    return { pdf: await readFile(output), log };
  } catch (error) {
    if (error instanceof CompileError) throw error;
    throw new CompileError((error as Error).message, log);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function tectonicAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tectonic", ["--version"], { stdio: "ignore" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}
