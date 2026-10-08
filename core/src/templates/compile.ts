import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { CompileError, compileTex, prescanTex } from "../render/index.js";
import { scanFiles, type UploadedTemplate } from "./storage.js";

const execute = promisify(execFile);
export function scanTex(source: string, name: string): void {
  const issues = prescanTex(source);
  if (issues.length)
    throw new CompileError(
      "Unsafe LaTeX input",
      issues.map((issue) => `${name}:${issue.line}: ${issue.message}`).join("\n"),
    );
}
export async function scanUpload(upload: UploadedTemplate): Promise<string> {
  const files = await scanFiles(upload.dir);
  if (!files.includes(upload.mainFile)) throw new CompileError("Template main file is missing");
  for (const name of files) {
    const contents = await readFile(join(upload.dir, name));
    const text = contents.toString("utf8");
    if (Buffer.from(text).equals(contents) || /\.(tex|sty|cls|cfg|def)$/i.test(name)) scanTex(text, name);
  }
  return readFile(join(upload.dir, upload.mainFile), "utf8");
}

// Bundle lookup and the stub run without any uploaded assets, options, class names or sample content.
export async function warmUploadedPackages(source: string): Promise<void> {
  scanTex(source, "main.tex");
  const clean = source.replace(/(?<!\\)%[^\r\n]*/g, "");
  const names = [
    ...new Set(
      [...clean.matchAll(/\\usepackage\s*(?:\[[^\]]*\]\s*)?\{([^{}]+)\}/g)].flatMap((match) =>
        (match[1] ?? "").split(",").map((name) => name.trim()),
      ),
    ),
  ];
  const packages: string[] = [];
  const dir = await mkdtemp(join(tmpdir(), "vita-upload-warm-"));
  try {
    for (const name of names) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)) continue;
      try {
        await execute("tectonic", ["-X", "bundle", "cat", `${name}.sty`], {
          cwd: dir,
          timeout: 60_000,
          maxBuffer: 20 * 1024 * 1024,
        });
        packages.push(name);
      } catch (error) {
        // A local .sty is left for the offline sandbox; lookup failures other than absence are surfaced.
        if (
          (error as { code?: number }).code !== 1 ||
          !/error: not found\b/.test((error as { stderr?: string }).stderr ?? "")
        )
          throw error;
      }
    }
    if (!packages.length) return;
    await writeFile(
      join(dir, "main.tex"),
      `\\documentclass{article}\n${packages.map((name) => `\\usepackage{${name}}`).join("\n")}\n\\begin{document}Cache warm-up.\\end{document}\n`,
    );
    await execute("tectonic", ["-X", "compile", "main.tex"], {
      cwd: dir,
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    throw new CompileError(
      "Template package cache warm-up failed",
      `${(error as Error).message}\n${(error as { stderr?: string }).stderr ?? ""}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function compileOriginal(upload: UploadedTemplate): Promise<{ pdf: Buffer; log: string }> {
  const source = await scanUpload(upload);
  await warmUploadedPackages(source);
  return compileTex({ tex: source, assetsDir: join(upload.dir, dirname(upload.mainFile)) });
}
