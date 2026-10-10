import { resolve } from "node:path";
import { initWorkspace } from "@vita/core";

export async function initCommand(dir: string, opts: { name?: string } = {}): Promise<void> {
  await initWorkspace(resolve(dir), { name: opts.name ?? "" });
}
