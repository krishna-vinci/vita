import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rules } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enforcePageLimit, loadRules, mergeRules } from "./rules.js";

let dir: string;
let root: string;
let instance: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vita-rules-"));
  root = join(dir, "workspace");
  instance = join(dir, "instance");
  await mkdir(join(root, "config"), { recursive: true });
  await mkdir(instance);
  vi.stubEnv("VITA_INSTANCE_DIR", instance);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

it("locks numeric caps, unions restrictions and preserves host categorical rules", () => {
  const host = {
    locked: true,
    max_pages: 2,
    max_bullet_chars: 180,
    banned_phrases: ["Team Player"],
    required_sections: ["Experience"],
    section_order: ["Experience", "Education"],
    date_format: "YYYY" as const,
    locale: "en-GB" as const,
  };
  const user = {
    max_pages: 4,
    max_bullet_chars: 220,
    banned_phrases: ["team player", "guru"],
    required_sections: ["Summary"],
    section_order: ["Education", "Experience"],
    date_format: "MM/YYYY" as const,
    locale: "en-US" as const,
  };
  expect(mergeRules(host, user)).toEqual({
    honesty: "balanced",
    min_fill: 0.85,
    max_pages: 2,
    max_bullet_chars: 180,
    banned_phrases: ["Team Player", "guru"],
    required_sections: ["Experience", "Summary"],
    section_order: host.section_order,
    date_format: "YYYY",
    locale: "en-GB",
  });
  expect(mergeRules(host, { max_pages: 1, max_bullet_chars: 100 })).toMatchObject({
    max_pages: 1,
    max_bullet_chars: 100,
    required_sections: ["Experience"],
  });
  expect(enforcePageLimit(4, 2)).toBe(2);
  expect(enforcePageLimit(1, 2)).toBe(1);
  expect(enforcePageLimit(2)).toBe(2);
});

it("loads config/rules.yaml with host locks, including an omitted user page limit", async () => {
  await writeFile(join(instance, "rules.yaml"), "locked: true\nmax_pages: 3\nrequired_sections: [Experience]\n");
  await writeFile(join(root, "config/rules.yaml"), "required_sections: [Summary]\n");
  expect(await loadRules({ root })).toMatchObject({
    locked: true,
    lockedMaxPages: 3,
    rules: { max_pages: 3, required_sections: ["Experience", "Summary"] },
  });
  vi.stubEnv("VITA_INSTANCE_DIR", "");
  expect((await loadRules({ root })).rules).toEqual({
    honesty: "balanced",
    min_fill: 0.85,
    max_pages: 1,
    required_sections: ["Summary"],
  });
});

it("lets users override unlocked host rules and rejects invalid mechanical settings", () => {
  expect(
    mergeRules(
      { locked: false, max_pages: 1, required_sections: ["Experience"] },
      { max_pages: 3, required_sections: [] },
    ),
  ).toEqual({ honesty: "balanced", min_fill: 0.85, max_pages: 3, required_sections: [] });
  for (const value of [
    { date_format: "anything" },
    { locale: "any" },
    { max_pages: 0 },
    { max_bullet_chars: -1 },
    { locked: true },
  ])
    expect(Rules.safeParse(value).success).toBe(false);
});

it("validates min_fill, preserves an omitted user floor and enforces a locked host floor", () => {
  expect(Rules.parse({}).min_fill).toBe(0.85);
  expect(mergeRules({ locked: true, min_fill: 0.9 }, { min_fill: 0.5 }).min_fill).toBe(0.9);
  expect(mergeRules({ locked: false, min_fill: 0.7 }, {}).min_fill).toBe(0.7);
  expect(Rules.safeParse({ min_fill: 1.1 }).success).toBe(false);
});

it("defaults to balanced and lets a locked host control honesty even when the user omits it", async () => {
  expect(Rules.parse({}).honesty).toBe("balanced");
  expect(mergeRules({ locked: true, honesty: "strict" }, { honesty: "trust" }).honesty).toBe("strict");
  expect(mergeRules({ locked: false, honesty: "strict" }, { honesty: "trust" }).honesty).toBe("trust");
  await writeFile(join(instance, "rules.yaml"), "locked: true\nhonesty: strict\n");
  expect((await loadRules({ root })).rules.honesty).toBe("strict");
  expect(Rules.safeParse({ honesty: "anything" }).success).toBe(false);
});
