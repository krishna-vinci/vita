import { type Bullet, type EvidenceKind, Finding, ItemMeta, Pack, Resume } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { buildClaimIndex } from "../claims/index.js";
import { parseOutline } from "../source/index.js";
import { type LintContext, lintResume } from "./index.js";

function context(): LintContext {
  const projects = {
    preamble: [],
    items: [
      {
        name: "Workshop",
        slug: "workshop",
        meta: ItemMeta.parse({
          evidence: [
            { id: "ev-time", kind: "measurement", text: "Preparation time fell by 70 percent." },
            { id: "ev-money", kind: "statement", text: "Saved $1.2M." },
            { id: "ev-count", kind: "doc", text: "Prepared 1,200 packages." },
            { id: "ev-unlinked", kind: "statement", text: "Served 999 visitors." },
          ],
        }),
        claims: [
          { id: "workshop-time", text: "Shortened preparation.", evidence: ["ev-time"], metrics: [] },
          { id: "workshop-money", text: "Reduced expenses.", evidence: ["ev-money"], metrics: [] },
          { id: "workshop-count", text: "Prepared materials.", evidence: ["ev-count"], metrics: [] },
          {
            id: "workshop-metric",
            text: "Improved throughput.",
            evidence: ["ev-time"],
            metrics: [{ value: "2x", kind: "measured" as const, evidence: ["ev-time"] }],
          },
          { id: "workshop-direct", text: "Supported 30 volunteers.", evidence: [], metrics: [] },
        ],
        limits: ["No independent supervision."],
        variants: [{ id: "workshop-variant", label: null, text: "Served 777 visitors." }],
        extra: [],
        line: 1,
      },
    ],
  };
  return {
    index: buildClaimIndex(
      projects,
      parseOutline("## Experience\n- Supported 12 volunteers. <!-- c:outline-volunteers -->"),
    ),
    pack: Pack.parse({ id: "general", name: "General", banned_phrases: ["team player"] }),
    rules: {},
  };
}

function resume(text: string, claims = ["workshop-time"], extra: Partial<Bullet> = {}): Resume {
  return Resume.parse({
    id: "test",
    kind: "master",
    parent: null,
    template: "rover-base",
    header: { name: "Fictional Person" },
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "entries",
        items: [
          {
            id: "workshop",
            title: "Workshop",
            period: "2020–2026",
            bullets: [{ id: "bullet", text, claims, ...extra }],
          },
        ],
      },
    ],
  });
}

function findings(text: string, claims?: string[], extra?: Partial<Bullet>, ctx = context()): Finding[] {
  return lintResume(resume(text, claims, extra), ctx);
}

function ruleFindings(
  rule: string,
  text: string,
  claims?: string[],
  extra?: Partial<Bullet>,
  ctx = context(),
): Finding[] {
  return findings(text, claims, extra, ctx).filter((finding) => finding.rule === rule);
}

describe("unsourced-number", () => {
  it.each([
    ["Reduced preparation time by 70%.", ["workshop-time"]],
    ["Saved $1,200,000.", ["workshop-money"]],
    ["Prepared 1.2k packages.", ["workshop-count"]],
    ["Improved throughput 2×.", ["workshop-metric"]],
    ["Supported 30 volunteers.", ["workshop-direct"]],
    ["Supported 12 volunteers.", ["outline-volunteers"]],
    ["Reduced preparation by 70% and saved $1.2M.", ["workshop-time", "workshop-money"]],
  ])("allows supported values: %s", (text, claims) => {
    expect(findings(text, claims)).toEqual([]);
  });

  it("blocks each unsupported number and does not match a substring, unit or unrelated claim", () => {
    const result = ruleFindings("unsourced-number", "Reduced errors by 7% and saved 1.2M; processed 120 records.");
    expect(result).toHaveLength(3);
    expect(result.map((finding) => finding.severity)).toEqual(["block", "block", "block"]);
    expect(ruleFindings("unsourced-number", "Supported 30 volunteers.")).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Reduced preparation by 70.")).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Saved €1.2M.", ["workshop-money"])).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Served 999 visitors.")).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Served 777 visitors.")).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Supported 30–40 volunteers.", ["workshop-direct"])).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Supported -30 volunteers.", ["workshop-direct"])).toHaveLength(1);
  });

  it.each<EvidenceKind>(["statement", "measurement", "doc", "code", "link"])(
    "uses text only from allowed evidence kinds: %s",
    (kind) => {
      const ctx = context();
      const claim = ctx.index.claims.get("workshop-time");
      if (!claim) throw new Error("Missing test claim");
      claim.evidence = [{ id: "ev-value", kind, text: "Prepared 42 packages." }];
      expect(ruleFindings("unsourced-number", "Prepared 42 packages.", undefined, undefined, ctx)).toHaveLength(
        ["statement", "measurement", "doc"].includes(kind) ? 0 : 1,
      );
    },
  );

  it("requires support for decimals following product names and ordinary action words", () => {
    const ctx = context();
    const claim = ctx.index.claims.get("workshop-time");
    if (!claim) throw new Error("Missing test claim");
    claim.text = "Used Python 3.12 and cut costs by 3.5%.";
    expect(findings("Used Python 3.12 and cut costs by 3.5%.", undefined, undefined, ctx)).toEqual([]);
    expect(ruleFindings("unsourced-number", "Used Python 3.13.", undefined, undefined, ctx)).toHaveLength(1);
    expect(ruleFindings("unsourced-number", "Changed 3.0 to 3.5.", undefined, undefined, ctx)).toHaveLength(2);
  });
});

describe("claim rules", () => {
  it("blocks missing AI claims and allows sourced AI bullets and user-origin bullets", () => {
    expect(findings("Organised materials.", [])).toEqual([
      { rule: "missing-claims", severity: "block", message: "AI-written bullet has no claim IDs.", bulletId: "bullet" },
    ]);
    expect(findings("Organised materials.")).toEqual([]);
    expect(findings("Organised materials.", [], { origin: "user" })).toEqual([]);
    expect(ruleFindings("unsourced-number", "Served 45 visitors.", [], { origin: "user" })).toHaveLength(1);
  });

  it("blocks unknown IDs even on user bullets and does not accept variant IDs as claims", () => {
    expect(findings("Organised materials.", ["absent"])).toEqual([
      { rule: "unknown-claim", severity: "block", message: "Unknown claim: absent.", bulletId: "bullet" },
    ]);
    expect(findings("Organised materials.", ["workshop-count"])).toEqual([]);
    expect(ruleFindings("unknown-claim", "Organised materials.", ["absent"], { origin: "user" })).toHaveLength(1);
    expect(ruleFindings("unknown-claim", "Served 777 visitors.", ["workshop-variant"])).toHaveLength(1);
  });
});

describe("limit-breach", () => {
  it.each([
    "No independent supervision.",
    "NOT independent supervision!",
    "Don't claim independent supervision.",
    "Avoid independent supervision.",
  ])("strips the prefix and punctuation from %s and matches case-insensitively", (limit) => {
    const ctx = context();
    const claim = ctx.index.claims.get("workshop-time");
    if (!claim) throw new Error("Missing test claim");
    claim.limits = [limit];
    expect(ruleFindings("limit-breach", "Provided INDEPENDENT SUPERVISION.", undefined, undefined, ctx)).toEqual([
      {
        rule: "limit-breach",
        severity: "block",
        message: `Bullet conflicts with claim limit: ${limit}`,
        bulletId: "bullet",
      },
    ]);
    expect(findings("Organised materials.", undefined, undefined, ctx)).toEqual([]);
  });

  it("ignores one-word limits and limits not linked to the bullet", () => {
    const ctx = context();
    const claim = ctx.index.claims.get("workshop-time");
    if (!claim) throw new Error("Missing test claim");
    claim.limits = ["No supervision.", "No.", "Avoid ..."];
    expect(findings("Provided supervision.", undefined, undefined, ctx)).toEqual([]);
    expect(findings("Provided independent supervision.", ["outline-volunteers"])).toEqual([]);
  });
});

describe("banned-phrase", () => {
  it("merges pack and user rules, uses whole words and handles literal regex characters", () => {
    const ctx = context();
    ctx.rules.banned_phrases = ["results-driven", "C++", "TEAM PLAYER", ""];
    expect(
      ruleFindings("banned-phrase", "A TEAM PLAYER with results-driven habits and C++.", undefined, undefined, ctx),
    ).toEqual([
      { rule: "banned-phrase", severity: "warn", message: "Banned phrase: team player.", bulletId: "bullet" },
      { rule: "banned-phrase", severity: "warn", message: "Banned phrase: results-driven.", bulletId: "bullet" },
      { rule: "banned-phrase", severity: "warn", message: "Banned phrase: c++.", bulletId: "bullet" },
    ]);
    expect(
      findings("Team players had results-drivenly worded notes and C++builder.", undefined, undefined, ctx),
    ).toEqual([]);
    expect(findings("Organised materials.", undefined, undefined, ctx)).toEqual([]);
  });

  it("respects Unicode word boundaries", () => {
    const ctx = context();
    ctx.rules.banned_phrases = ["café"];
    expect(ruleFindings("banned-phrase", "Café.", undefined, undefined, ctx)).toHaveLength(1);
    expect(findings("caféteria", undefined, undefined, ctx)).toEqual([]);
  });
});

describe("bullet-length", () => {
  it("allows the default maximum and warns when exceeded", () => {
    expect(findings("a".repeat(220))).toEqual([]);
    expect(findings("a".repeat(221))).toEqual([
      {
        rule: "bullet-length",
        severity: "warn",
        message: "Bullet has 221 characters; maximum is 220.",
        bulletId: "bullet",
      },
    ]);
  });

  it("honours configured maximum, including zero", () => {
    const ctx = context();
    ctx.rules.max_bullet_chars = 5;
    expect(findings("abcde", undefined, undefined, ctx)).toEqual([]);
    expect(ruleFindings("bullet-length", "abcdef", undefined, undefined, ctx)).toHaveLength(1);
    ctx.rules.max_bullet_chars = 0;
    expect(findings("", undefined, undefined, ctx)).toEqual([]);
    expect(ruleFindings("bullet-length", "a", undefined, undefined, ctx)).toHaveLength(1);
  });
});

describe("visibility and overrides", () => {
  it.each(["user-attested", "this-resume-only"] as const)(
    "suppresses only unsourced-number for %s overrides",
    (reason) => {
      const override = { reason, at: "2026-10-09" };
      expect(findings("Served 999 visitors.", undefined, { override })).toEqual([]);
      const result = findings(
        `${"a".repeat(230)} 999 team player independent supervision.`,
        ["workshop-time", "absent"],
        { override },
      );
      expect(result.map((finding) => finding.rule)).toEqual([
        "unknown-claim",
        "limit-breach",
        "banned-phrase",
        "bullet-length",
      ]);
      expect(ruleFindings("missing-claims", "Served 999 visitors.", [], { override })).toHaveLength(1);
    },
  );

  it.each(["section", "item", "bullet"] as const)("does not lint content hidden at %s level", (level) => {
    const value = resume("Served 999 team player visitors with independent supervision.", ["workshop-time", "absent"]);
    const section = value.sections[0];
    const item = section?.items[0];
    const bullet = item?.bullets[0];
    if (!section || !item || !bullet) throw new Error("Missing test resume content");
    expect(lintResume(value, context())).toHaveLength(4);
    if (level === "section") section.hidden = true;
    if (level === "item") item.hidden = true;
    if (level === "bullet") bullet.hidden = true;
    expect(lintResume(value, context())).toEqual([]);
  });

  it("lints all visible bullets in document order, leaves metadata exempt and does not mutate inputs", () => {
    const value = resume("Served 999 visitors.");
    const item = value.sections[0]?.items[0];
    if (!item) throw new Error("Missing test item");
    item.bullets.push({ id: "second", text: "Organised materials.", claims: [], origin: "ai", locked: true });
    const ctx = context();
    const beforeResume = structuredClone(value);
    const beforeContext = structuredClone(ctx);
    const result = lintResume(value, ctx);
    expect(result.map((finding) => [finding.bulletId, finding.rule])).toEqual([
      ["bullet", "unsourced-number"],
      ["second", "missing-claims"],
    ]);
    for (const finding of result) expect(Finding.safeParse(finding).success).toBe(true);
    expect(value).toEqual(beforeResume);
    expect(ctx).toEqual(beforeContext);
    expect(findings("Organised materials.")).toEqual([]);
  });
});
