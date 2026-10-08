import type { JobAnalysis, Prep } from "@vita/shared";
import type { ClaimIndex } from "../claims/index.js";
import { normalizeNumber } from "../lint/numbers.js";

// Outcomes have no year or version exemptions: every number needs a receipt.
function numbers(text: string): string[] {
  return [
    ...text.matchAll(/[$€£₹]?[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[kMB]\b)?(?:\s*(?:percent\b|%|[x×]\b))?/gi),
  ].map((match) => normalizeNumber(match[0]));
}

function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
}

export function checkPrep(draft: Prep, index: ClaimIndex, analysis: JobAnalysis): { prep: Prep; flags: string[] } {
  const prep = structuredClone(draft);
  const flags: string[] = [];
  for (const entry of [...prep.questions, ...prep.stories]) {
    for (const id of entry.claimIds)
      if (!index.claims.has(id)) throw new Error(`Interview prep ${entry.id} cites unknown claim: ${id}`);
  }
  for (const story of prep.stories) {
    if (!story.action.trim() || !story.claimIds.length)
      throw new Error(`Interview story ${story.id} requires an action with claim IDs`);
    if (story.result === null) continue;
    const claims = story.claimIds.flatMap((id) => {
      const claim = index.claims.get(id);
      return claim ? [claim] : [];
    });
    const metricNumbers = new Set(
      claims.flatMap((claim) =>
        claim.metrics
          .filter((metric) => metric.evidence.some((id) => claim.evidence.some((entry) => entry.id === id)))
          .flatMap((metric) => numbers(metric.value)),
      ),
    );
    const supportedNumbers = new Set([...metricNumbers, ...claims.flatMap((claim) => numbers(claim.text))]);
    const resultNumbers = numbers(story.result);
    const textSupported =
      !!normalized(story.result) &&
      claims.some((claim) => normalized(claim.text).includes(normalized(story.result ?? "")));
    if (
      resultNumbers.some((number) => !supportedNumbers.has(number)) ||
      (!textSupported && !(resultNumbers.length && resultNumbers.every((number) => metricNumbers.has(number))))
    ) {
      story.result = null;
      flags.push(`Story ${story.id}: unsupported result cleared; add evidence or fill in your actual result.`);
    }
  }
  const requirements = new Set(analysis.requirements.map((requirement) => requirement.id));
  for (const gap of prep.gaps) {
    if (!requirements.has(gap.requirementId))
      throw new Error(`Interview gap cites unknown requirement: ${gap.requirementId}`);
    if (!/^no\b/i.test(gap.honestAnswer.trim()))
      throw new Error(`Interview gap ${gap.requirementId} must start with a plain "No" before bridging`);
  }
  return { prep, flags };
}
