import { EventEmitter } from "node:events";
import { createGenerationRuntime, ModelsConfig } from "@vita/core";
import { afterEach, expect, it, vi } from "vitest";
import { type DoctorProbes, runDoctor } from "./doctor";
import { bundledPiBinary, loginCommand } from "./login";
import { modelsCommand } from "./models";

const options = { dataDir: "/test/data", agentDir: "/test/pi", dir: "/test/workspace" };
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function probes(): Promise<DoctorProbes> {
  const created = await createGenerationRuntime([]);
  close = created.close;
  return {
    nodeVersion: "22.19.0",
    sqlite: vi.fn(async () => {}),
    command: vi.fn(async () => {}),
    warmCache: vi.fn(async () => {}),
    writable: vi.fn(async () => {}),
    github: vi.fn(async () => {}),
    loadConfig: vi.fn(async () => ModelsConfig.parse(created.models)),
    runtime: async () => ({ runtime: created.runtime, close: vi.fn(async () => {}) }),
  };
}

it("doctor passes a complete setup, checks all roles and treats GitHub failure as a warning", async () => {
  const injected = await probes();
  injected.github = vi.fn(async () => {
    throw new Error("offline");
  });
  const result = await runDoctor(options, injected);
  expect(result.filter((check) => check.status === "FAIL")).toEqual([]);
  expect(result.filter((check) => check.item.startsWith("Model:"))).toHaveLength(13);
  expect(result.find((check) => check.item === "GitHub research")?.status).toBe("WARN");
  expect(injected.writable).toHaveBeenCalledWith("/test/data");
  expect(injected.command).toHaveBeenCalledWith("pdftotext", ["-v"]);
  expect(result.every((check) => check.fix.length > 0)).toBe(true);
});

it("doctor reports failed dependencies, cold cache, unknown and uncredentialed models, and identical checker", async () => {
  const injected = await probes();
  injected.nodeVersion = "20.0.0";
  injected.command = vi.fn(async (binary) => {
    if (binary === "git") throw new Error("missing git");
  });
  injected.warmCache = vi.fn(async () => {
    throw new Error("cold cache");
  });
  injected.writable = vi.fn(async () => {
    throw new Error("EACCES");
  });
  const runtime = (await injected.runtime()).runtime;
  const known = runtime.getModels().find((model) => model.provider !== "faux");
  if (!known) throw new Error("No catalog models");
  injected.loadConfig = vi.fn(async () =>
    ModelsConfig.parse({
      default: "unknown/model",
      roles: { writer: `${known.provider}/${known.id}`, checker: `${known.provider}/${known.id}` },
    }),
  );
  const result = await runDoctor(options, injected);
  for (const item of [
    "Node and node:sqlite",
    "git",
    "Tectonic cache",
    "Data directory",
    "Model: default",
    "Model: writer",
    "Independent checker",
  ])
    expect(result.find((check) => check.item === item)?.status, item).toBe("FAIL");
  expect(result.find((check) => check.item === "Tectonic cache")?.fix).toContain("pnpm vita setup");
});

it("doctor identifies no provider credentials, missing workspace and unavailable SQLite without using network", async () => {
  const injected = await probes();
  injected.sqlite = vi.fn(async () => {
    throw new Error("SQLite disabled");
  });
  const runtime = (await injected.runtime()).runtime;
  vi.spyOn(runtime, "getAvailable").mockResolvedValue([]);
  const result = await runDoctor({ ...options, dir: undefined }, injected);
  expect(result.find((check) => check.item === "Pi agent directory")).toMatchObject({
    status: "FAIL",
    detail: expect.stringContaining("/test/pi"),
  });
  expect(result.find((check) => check.item === "Pi agent directory")?.fix).toContain("pnpm vita login");
  expect(result.find((check) => check.item === "Workspace models")?.status).toBe("WARN");
  expect(result.find((check) => check.item === "Node and node:sqlite")?.status).toBe("FAIL");
});

it("models --available maps only authenticated faux models and closes the runtime", async () => {
  const created = await createGenerationRuntime([]);
  close = created.close;
  const print = vi.fn();
  const cleanup = vi.fn(async () => {});
  await modelsCommand({ available: true }, async () => ({ runtime: created.runtime, close: cleanup }), print);
  expect(print.mock.calls.map(([line]) => line)).toEqual([
    "faux/checker [credentials]",
    "faux/default [credentials]",
    "faux/writer [credentials]",
  ]);
  expect(cleanup).toHaveBeenCalledOnce();
  print.mockClear();
  await modelsCommand({}, async () => ({ runtime: created.runtime, close: cleanup }), print);
  expect(print.mock.calls.some(([line]) => !line.includes("[credentials]"))).toBe(true);
});

it("login launches the pinned Pi binary interactively with inherited environment and forwards failure", async () => {
  vi.stubEnv("PI_CODING_AGENT_DIR", "/test/pi");
  const child = new EventEmitter();
  const launch = vi.fn(() => child);
  const print = vi.fn();
  const pending = loginCommand(launch as unknown as Parameters<typeof loginCommand>[0], print);
  expect(launch).toHaveBeenCalledWith(process.execPath, [bundledPiBinary()], { stdio: "inherit", env: process.env });
  expect(bundledPiBinary()).toMatch(/@earendil-works\/pi-coding-agent\/dist\/bundle\/cli\.js$/);
  expect(print.mock.calls.flat().join("\n")).toBe(
    "Type /login, choose your provider, finish the browser or device step,\nthen /quit.",
  );
  child.emit("close", 0, null);
  await pending;
  const failure = loginCommand(launch as unknown as Parameters<typeof loginCommand>[0], print);
  child.emit("close", 2, null);
  await expect(failure).rejects.toThrow("code 2");
});
