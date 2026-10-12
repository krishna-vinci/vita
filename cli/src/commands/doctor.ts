import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compileTex, createGenerationRuntime, loadModelsConfig, loadTemplate, renderTex } from "@vita/core";
import { ApiModelsConfig, providerSetupHints, Resume } from "@vita/shared";
import { bundledTemplatesDir } from "../paths";
import { listModels, type RuntimeFactory } from "./models";

const execute = promisify(execFile);
export interface DoctorCheck {
  item: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
  fix: string;
}
export interface DoctorProbes {
  nodeVersion: string;
  sqlite: () => Promise<void>;
  command: (binary: string, args: string[]) => Promise<void>;
  warmCache: () => Promise<void>;
  writable: (dir: string) => Promise<void>;
  github: () => Promise<void>;
  loadConfig: typeof loadModelsConfig;
  runtime: RuntimeFactory;
}

const nativeProbes: DoctorProbes = {
  nodeVersion: process.versions.node,
  sqlite: async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.close();
  },
  command: async (binary, args) => {
    await execute(binary, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
  },
  warmCache: async () => {
    const template = await loadTemplate([bundledTemplatesDir], "rover-base");
    const sample = Resume.parse({
      id: "sample",
      kind: "master",
      parent: null,
      template: "rover-base",
      header: { name: "Alex Example", contact: [] },
      sections: [
        { id: "summary", title: "Summary", kind: "summary", text: "Clear communication and careful planning." },
      ],
    });
    await compileTex({ tex: renderTex(sample, template), assetsDir: template.dir, timeoutMs: 10_000 });
  },
  writable: async (dir) => {
    await mkdir(dir, { recursive: true });
    const probe = await mkdtemp(join(dir, ".vita-doctor-"));
    await rm(probe, { recursive: true });
  },
  github: async () => {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "vita-doctor" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { resources?: { core?: { remaining?: number } } };
    if (!body.resources?.core?.remaining) throw new Error("Anonymous GitHub rate limit exhausted or unavailable");
  },
  loadConfig: loadModelsConfig,
  runtime: createGenerationRuntime,
};

export async function runDoctor(
  options: { dir?: string; dataDir: string; agentDir: string },
  probes: DoctorProbes = nativeProbes,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (item: string, status: DoctorCheck["status"], detail: string, fix = "No action needed.") =>
    checks.push({ item, status, detail, fix });
  const check = async (
    item: string,
    probe: () => Promise<void>,
    fix: string,
    failure: "WARN" | "FAIL" = "FAIL",
    detail = "Ready",
  ) => {
    try {
      await probe();
      add(item, "PASS", detail);
      return true;
    } catch (error) {
      add(item, failure, error instanceof Error ? error.message : String(error), fix);
      return false;
    }
  };
  await check(
    "Node and node:sqlite",
    async () => {
      const [major = 0, minor = 0] = probes.nodeVersion.split(".").map(Number);
      if (major < 22 || (major === 22 && minor < 19)) throw new Error(`Node ${probes.nodeVersion}`);
      await probes.sqlite();
    },
    "Install Node 22.19 or newer (Node 22 LTS recommended), with node:sqlite enabled.",
    "FAIL",
    `Node ${probes.nodeVersion}; node:sqlite available`,
  );
  await check("git", () => probes.command("git", ["--version"]), "Install git and put it on PATH.");
  const tectonic = await check(
    "Tectonic",
    () => probes.command("tectonic", ["--version"]),
    "Install Tectonic 0.17.0 and put it on PATH, then run `pnpm vita setup`.",
  );
  if (tectonic)
    await check(
      "Tectonic cache",
      probes.warmCache,
      "Run `pnpm vita setup` as the same OS user as Vita to warm the bundled template cache.",
    );
  else add("Tectonic cache", "FAIL", "Cannot check without Tectonic", "Install Tectonic, then run `pnpm vita setup`.");
  for (const binary of ["pdftotext", "pdfinfo"])
    await check(
      binary,
      () => probes.command(binary, ["-v"]),
      "Install poppler-utils (Debian/Ubuntu) or poppler (macOS), and put its binaries on PATH.",
    );
  await check(
    "Data directory",
    () => probes.writable(options.dataDir),
    "Make VITA_DATA_DIR writable by the Vita user (Docker mount owner: uid/gid 1000).",
    "FAIL",
    options.dataDir,
  );

  let created: Awaited<ReturnType<RuntimeFactory>> | undefined;
  try {
    created = await probes.runtime();
    const models = await listModels(created.runtime);
    const available = new Set(models.filter((model) => model.hasCredentials).map((model) => model.id));
    const providers = [...new Set([...available].map((id) => id.split("/")[0]))].sort();
    add(
      "Pi agent directory",
      providers.length ? "PASS" : "FAIL",
      `${options.agentDir}; providers with credentials: ${providers.join(", ") || "none"}`,
      providers.length ? undefined : providerSetupHints.join("\n  Fix: "),
    );
    if (options.dir) {
      try {
        const config = await probes.loadConfig(options.dir);
        const roles = Object.keys(ApiModelsConfig.shape.roles.unwrap().shape);
        for (const role of ["default", ...roles]) {
          const id =
            role === "default" ? config.default : (config.roles[role as keyof typeof config.roles] ?? config.default);
          const known = models.some((model) => model.id === id);
          add(
            `Model: ${role}`,
            available.has(id) ? "PASS" : "FAIL",
            `${id}${known ? "" : " (unknown model)"}`,
            available.has(id)
              ? undefined
              : `Choose a known model with credentials in Settings or ${options.dir}/config/models.yaml; run \`pnpm vita models --available\`.`,
          );
        }
        const writer = config.roles.writer ?? config.default;
        const checker = config.roles.checker ?? config.default;
        add(
          "Independent checker",
          writer === checker ? "FAIL" : "PASS",
          `writer=${writer}; checker=${checker}`,
          writer === checker
            ? "Choose a different provider/model for checker in Settings or config/models.yaml."
            : undefined,
        );
      } catch (error) {
        add(
          "Workspace models",
          "FAIL",
          error instanceof Error ? error.message : String(error),
          "Pass an initialized workspace to `pnpm vita doctor <dir>`; set its models in Settings or config/models.yaml.",
        );
      }
    } else
      add(
        "Workspace models",
        "WARN",
        "No workspace selected",
        "After account setup, run `pnpm vita users` to find the workspace, then `pnpm vita doctor <absolute-workspace-dir>`.",
      );
  } catch (error) {
    add(
      "Pi models",
      "FAIL",
      error instanceof Error ? error.message : String(error),
      `Check auth.json and models.json in ${options.agentDir}. ${providerSetupHints.join(" ")}`,
    );
  } finally {
    await created?.close();
  }
  await check(
    "GitHub research",
    probes.github,
    "Check connectivity to api.github.com; public research works anonymously. Add an optional GitHub token in Settings for higher limits.",
    "WARN",
  );
  return checks;
}

export async function doctorCommand(dir?: string): Promise<DoctorCheck[]> {
  const checks = await runDoctor({
    dir: dir ? resolve(dir) : process.env.VITA_WORKSPACE ? resolve(process.env.VITA_WORKSPACE) : undefined,
    dataDir: resolve(process.env.VITA_DATA_DIR ?? fileURLToPath(new URL("../../../server/vita-home", import.meta.url))),
    agentDir: resolve(
      process.env.PI_CODING_AGENT_DIR?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".pi/agent"),
    ),
  });
  for (const result of checks) console.log(`${result.status} ${result.item}: ${result.detail}\n  Fix: ${result.fix}`);
  if (checks.some((result) => result.status === "FAIL")) process.exitCode = 1;
  return checks;
}
