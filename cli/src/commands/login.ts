import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Resolve through core, the package that owns the pinned Pi dependency.
export function bundledPiBinary(): string {
  const require = createRequire(import.meta.url);
  const coreRequire = createRequire(require.resolve("@vita/core"));
  // Pi exports only ESM entry points; resolve its executable via the package
  // manifest rather than asking the CommonJS resolver for its library entry.
  const packageDir = coreRequire.resolve
    .paths("@earendil-works/pi-coding-agent")
    ?.map((dir) => resolve(dir, "@earendil-works/pi-coding-agent"))
    .find((dir) => existsSync(resolve(dir, "package.json")));
  if (!packageDir) throw new Error("Bundled Pi is missing; run pnpm install --frozen-lockfile.");
  const manifest = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
  return resolve(packageDir, manifest.bin.pi);
}

export async function loginCommand(
  launch: typeof spawn = spawn,
  print: (line: string) => void = console.log,
): Promise<void> {
  print("Type /login, choose your provider, finish the browser or device step,");
  print("then /quit.");
  await new Promise<void>((done, reject) => {
    const child = launch(process.execPath, [bundledPiBinary()], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) done();
      else reject(new Error(`Pi exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
    });
  });
}
