import { Rules } from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { optionalInstructionText } from "./load.js";

// Zod 4 applies inner defaults even under optional; omission must preserve the host value.
const partialRules = Rules.partial().extend({ max_pages: Rules.shape.max_pages.removeDefault().optional() });
const instanceRules = partialRules.extend({ locked: z.boolean().default(false) });

function union(a: string[] = [], b: string[] = []): string[] {
  const seen = new Set<string>();
  return [...a, ...b].filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeRules(instance: z.infer<typeof instanceRules>, user: z.infer<typeof partialRules>): Rules {
  const { locked, ...host } = instance;
  const merged = { ...host, ...user };
  if (locked) {
    for (const key of ["max_pages", "max_bullet_chars"] as const) {
      if (host[key] !== undefined) merged[key] = Math.min(host[key], user[key] ?? host[key]);
    }
    for (const key of ["banned_phrases", "required_sections"] as const) {
      if (host[key] !== undefined) merged[key] = union(host[key], user[key]);
    }
    // These categorical constraints have no tighter ordering: the locked host value wins.
    for (const key of ["section_order", "date_format", "locale"] as const) {
      if (host[key] !== undefined) Object.assign(merged, { [key]: host[key] });
    }
  }
  return Rules.parse(merged);
}

export async function loadRules(ws: Pick<WorkspaceHandle, "root">) {
  const instance = process.env.VITA_INSTANCE_DIR;
  const [hostText, userText] = await Promise.all([
    instance ? optionalInstructionText(instance, "rules.yaml") : undefined,
    optionalInstructionText(ws.root, "config/rules.yaml"),
  ]);
  const host = instanceRules.parse(hostText === undefined ? {} : (parseYaml(hostText) ?? {}));
  const user = partialRules.parse(userText === undefined ? {} : (parseYaml(userText) ?? {}));
  return {
    rules: mergeRules(host, user),
    userRules: Rules.parse(user),
    locked: host.locked,
    lockedMaxPages: host.locked ? host.max_pages : undefined,
  };
}

/** Base and master budgets may specialize user rules, but cannot lift a host cap. */
export function enforcePageLimit(requested: number, lockedMaxPages?: number): number {
  return Math.min(requested, lockedMaxPages ?? requested);
}
