import { type Finding, type Pack, type Resume, type Rules, visibleBullets } from "@vita/shared";
import type { ClaimIndex, IndexedClaim } from "../claims/index.js";
import { actionVoiceProblem } from "./action-voice.js";
import { extractNumbers, normalizeNumber } from "./numbers.js";
import { lintExtraRules } from "./rules-extra.js";

export interface LintContext {
  index: ClaimIndex;
  pack: Pack;
  rules: Partial<Rules>;
  /**
   * Action voice is a writing-style rule: it blocks AI drafts, but only warns when re-rendering or
   * editing a resume the person already approved, and on bullets the person wrote.
   */
  voice?: "block" | "warn";
}

function supportedNumbers(claims: IndexedClaim[], strict = false): Set<string> {
  const values = new Set<string>();
  for (const claim of claims) {
    for (const metric of claim.metrics) values.add(normalizeNumber(metric.value));
    const texts =
      !strict && claim.evidence.length && claim.evidence.every((receipt) => receipt.kind === "statement")
        ? []
        : [claim.text];
    for (const evidence of claim.evidence) {
      if (["statement", "measurement", "doc"].includes(evidence.kind) && evidence.text) texts.push(evidence.text);
    }
    for (const text of texts) {
      for (const number of extractNumbers(text)) values.add(number.norm);
    }
  }
  return values;
}

/** Values whose only matching receipt is the person's own statement. */
export function statementOnlyNumbers(claims: IndexedClaim[]): Set<string> {
  const nonStatement = new Set(
    claims.flatMap((claim) => {
      const receipts = claim.evidence.filter((receipt) => receipt.kind !== "statement");
      const hasStatement = claim.evidence.some((receipt) => receipt.kind === "statement");
      return [
        ...(!hasStatement ? extractNumbers(claim.text).map((number) => number.norm) : []),
        ...receipts.flatMap((receipt) => extractNumbers(receipt.text ?? "").map((number) => number.norm)),
        ...claim.metrics
          .filter(
            (metric) => !hasStatement || metric.evidence.some((id) => receipts.some((receipt) => receipt.id === id)),
          )
          .map((metric) => normalizeNumber(metric.value)),
      ];
    }),
  );
  const statements = new Set(
    claims.flatMap((claim) =>
      claim.evidence
        .filter((receipt) => receipt.kind === "statement")
        .flatMap((receipt) => extractNumbers(receipt.text ?? "").map((number) => number.norm)),
    ),
  );
  return new Set([...statements].filter((number) => !nonStatement.has(number)));
}

function limitPhrase(limit: string): string {
  return limit
    .trim()
    .replace(/^(?:no\s+|not\s+|don't\s+claim\s+|avoid\s+)/i, "")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

export function lintResume(resume: Resume, ctx: LintContext): Finding[] {
  const findings = lintExtraRules(resume, {
    ...ctx.rules,
    section_order: ctx.rules.section_order ?? ctx.pack.section_order,
  });
  for (const section of resume.sections.filter((section) => !section.hidden && section.kind === "list")) {
    const items = section.items.filter((item) => !item.hidden);
    const item = items[0];
    if (
      items.length === 1 &&
      item &&
      (!item.title.trim() || /^(?:skills|technical skills|all|general)$/i.test(item.title.trim())) &&
      item.bullets.filter((bullet) => !bullet.hidden).length >= 5
    ) {
      findings.push({
        rule: "uncategorised-skills",
        severity: "warn",
        message: "Group this skills list into labelled categories (item titles).",
      });
    }
  }
  const titles = [...ctx.index.items.values()].map((item) => item.name);
  titles.push(...resume.sections.flatMap((section) => section.items.map((item) => item.title)));
  const banned = [
    ...new Set(
      [...ctx.pack.banned_phrases, ...(ctx.rules.banned_phrases ?? [])]
        .map((phrase) => phrase.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const maxChars = ctx.rules.max_bullet_chars ?? 220;
  for (const bullet of visibleBullets(resume)) {
    const add = (rule: string, severity: Finding["severity"], message: string) => {
      if (
        ctx.rules.honesty === "trust" &&
        ["missing-claims", "unknown-claim", "unsourced-number", "limit-breach"].includes(rule)
      )
        severity = "warn";
      findings.push({ rule, severity, message, bulletId: bullet.id });
    };
    const voice = actionVoiceProblem(bullet.text, titles);
    if (voice) add("action-voice", bullet.origin === "user" || ctx.voice === "warn" ? "warn" : "block", voice);
    if (bullet.origin === "ai" && bullet.claims.length === 0) {
      add("missing-claims", "block", "AI-written bullet has no claim IDs.");
    }
    const claims: IndexedClaim[] = [];
    for (const id of new Set(bullet.claims)) {
      const claim = ctx.index.claims.get(id);
      if (claim) claims.push(claim);
      else add("unknown-claim", "block", `Unknown claim: ${id}.`);
    }
    if (!bullet.override) {
      const supported = supportedNumbers(claims, ctx.rules.honesty === "strict");
      const estimates = statementOnlyNumbers(claims);
      for (const number of extractNumbers(bullet.text)) {
        if ((ctx.rules.honesty ?? "balanced") !== "strict" && estimates.has(number.norm))
          add("statement-estimate", "warn", `Your estimate: ${number.raw}`);
        if (!supported.has(number.norm)) {
          add(
            "unsourced-number",
            "block",
            `Number "${number.raw}" has no support in this bullet's claims or linked evidence.`,
          );
        }
      }
    }
    for (const limit of new Set(claims.flatMap((claim) => claim.limits))) {
      const phrase = limitPhrase(limit);
      if (phrase.split(/\s+/).length >= 2 && bullet.text.toLowerCase().includes(phrase.toLowerCase())) {
        add("limit-breach", "block", `Bullet conflicts with claim limit: ${limit}`);
      }
    }
    for (const phrase of banned) {
      if (containsPhrase(bullet.text, phrase)) add("banned-phrase", "warn", `Banned phrase: ${phrase}.`);
    }
    if (bullet.text.length > maxChars) {
      add("bullet-length", "warn", `Bullet has ${bullet.text.length} characters; maximum is ${maxChars}.`);
    }
  }
  return findings;
}
