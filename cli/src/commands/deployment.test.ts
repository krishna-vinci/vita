import { execFile, execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
function present(binary: string, args: string[]): boolean {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const docker = present("docker", ["compose", "version"]);
const systemd = present("systemd-analyze", ["--version"]);
if (!docker)
  console.warn(
    "Skipping Compose validation: Docker Compose is not installed. See docs/SELF_HOSTING.md for the manual check.",
  );

it("installs a pinned user unit with paths containing spaces and percent signs using stub services", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "vita-service-test-"));
  try {
    const checkout = join(scratch, "checkout with spaces % literal");
    for (const dir of ["scripts", "deploy", "server"]) await mkdir(join(checkout, dir), { recursive: true });
    for (const file of ["scripts/install-service.sh", "deploy/vita.service"])
      await copyFile(join(repo, file), join(checkout, file));
    const bin = join(scratch, "bin");
    await mkdir(bin);
    const calls = join(scratch, "calls");
    for (const name of ["pnpm", "systemctl"]) {
      await writeFile(join(bin, name), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$VITA_TEST_CALLS"\n');
      await chmod(join(bin, name), 0o755);
    }
    const config = join(scratch, "config");
    const data = join(scratch, "data with spaces %");
    const { stdout } = await execute("bash", [join(checkout, "scripts/install-service.sh")], {
      env: {
        PATH: `${bin}:${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
        XDG_CONFIG_HOME: config,
        VITA_DATA_DIR: data,
        VITA_TEST_CALLS: calls,
        USER: "vita-test",
      },
    });
    const unitPath = join(config, "systemd/user/vita.service");
    const unit = await readFile(unitPath, "utf8");
    expect(unit).toContain(`WorkingDirectory=${checkout.replaceAll("%", "%%")}/server`);
    expect(unit).toContain(`ExecStart="${bin}/pnpm" --filter @vita/server exec "${process.execPath}"`);
    expect(unit).toContain(`Environment="VITA_DATA_DIR=${data.replaceAll("%", "%%")}"`);
    expect(await readFile(calls, "utf8")).toBe(
      "build:web\n--user daemon-reload\n--user enable vita.service\n--user restart vita.service\n",
    );
    expect(stdout).toContain("http://127.0.0.1:4317");
    expect(stdout).toContain("journalctl --user -u vita -f");
    if (systemd) {
      const verified = await execute("systemd-analyze", ["--user", "verify", unitPath]);
      expect(verified.stderr).toBe("");
    }
    await execute("bash", ["-n", join(repo, "scripts/install-service.sh")]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

it.skipIf(!docker)("validates release Compose without reading credentials or contacting the daemon", async () => {
  await execute("docker", [
    "compose",
    "--env-file",
    "/dev/null",
    "-f",
    join(repo, "compose.yaml"),
    "config",
    "--no-env-resolution",
    "--quiet",
  ]);
});
