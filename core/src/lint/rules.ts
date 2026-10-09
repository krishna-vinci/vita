import { type Finding, type Pack, type Resume, type Rules, visibleBullets } from "@vita/shared";
import type { ClaimIndex, IndexedClaim } from "../claims/index.js";
import { extractNumbers, normalizeNumber } from "./numbers.js";
import { lintExtraRules } from "./rules-extra.js";

export interface LintContext {
  index: ClaimIndex;
  pack: Pack;
  rules: Partial<Rules>;
}

function supportedNumbers(claims: IndexedClaim[]): Set<string> {
  const values = new Set<string>();
  for (const claim of claims) {
    for (const metric of claim.metrics) values.add(normalizeNumber(metric.value));
    const texts = [claim.text];
    for (const evidence of claim.evidence) {
      if (["statement", "measurement", "doc"].includes(evidence.kind) && evidence.text) texts.push(evidence.text);
    }
    for (const text of texts) {
      for (const number of extractNumbers(text)) values.add(number.norm);
    }
  }
  return values;
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
      findings.push({ rule, severity, message, bulletId: bullet.id });
    };
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
      const supported = supportedNumbers(claims);
      for (const number of extractNumbers(bullet.text)) {
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
