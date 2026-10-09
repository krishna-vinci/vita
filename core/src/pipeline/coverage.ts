import type { Requirement } from "@vita/shared";

// Words too general to prove anything on their own ("system administration" must not match on "system").
const GENERIC = new Set([
  "ability",
  "analysis",
  "application",
  "applications",
  "administration",
  "best",
  "critical",
  "design",
  "development",
  "efficiency",
  "experience",
  "familiarity",
  "health",
  "implementation",
  "knowledge",
  "language",
  "languages",
  "level",
  "maintenance",
  "management",
  "measures",
  "operational",
  "operations",
  "platform",
  "platforms",
  "practices",
  "resource",
  "resources",
  "service",
  "services",
  "skills",
  "solutions",
  "strong",
  "system",
  "systems",
  "task",
  "tasks",
  "technologies",
  "technology",
  "tool",
  "tooling",
  "tools",
  "understanding",
  "usage",
  "using",
  "work",
  "working",
  "with",
  "and",
  "the",
  "for",
]);

export function keywordMatches(text: string, keyword: string): boolean {
  if (!keyword.trim()) return false;
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/**
 * A synonym group plus the distinctive single words of its multi-word phrases, so
 * "Linux system administration" is also found as "Linux". Generic words are dropped.
 */
export function expandGroup(group: string[]): string[] {
  const terms = new Set(group.map((term) => term.trim()).filter(Boolean));
  for (const term of group) {
    const words = term.split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);
    if (words.length < 2) continue;
    for (const word of words) {
      const acronym = /^[A-Z0-9]{2,}$/.test(word);
      if ((word.length >= 3 || acronym) && !GENERIC.has(word.toLowerCase())) terms.add(word);
    }
  }
  return [...terms];
}

const SUFFIXES = [
  "izations",
  "ization",
  "ations",
  "ation",
  "ments",
  "ment",
  "ings",
  "ing",
  "ions",
  "ion",
  "ed",
  "es",
  "s",
];

/** Crude stem so "Monitored" meets "monitoring" and "Automated" meets "automation". */
export function stem(word: string): string {
  const lower = word.toLowerCase();
  for (const suffix of SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length - suffix.length >= 4) return lower.slice(0, -suffix.length);
  }
  return lower;
}

function termMatches(text: string, term: string): boolean {
  if (keywordMatches(text, term)) return true;
  // Single words also match other forms of the same stem; phrases stay exact.
  if (/\s/.test(term.trim()) || term.trim().length < 5) return false;
  const root = stem(term.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${root}[\\p{L}]*(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** Requirements list alternatives ("AWS, GCP or Azure"): any one group with a match covers it. */
export function requirementCoveredByText(text: string, requirement: Requirement): boolean {
  return requirement.keywords.some((group) => expandGroup(group).some((term) => termMatches(text, term)));
}

export function requirementLabel(requirement: Requirement): string {
  const label = requirement.label?.trim() || requirement.keywords[0]?.[0]?.trim() || requirement.text.trim();
  return label.replace(/[.?!]+$/, "");
}

export function gapQuestion(requirement: Requirement): string {
  return `Have you worked with ${requirementLabel(requirement)}?`;
}

/** "Yes" answers become user-attested facts; "no", "skip" and empty answers do not. */
export function answerFact(answer: string): string | null {
  const trimmed = answer.trim();
  if (!/^yes\b/i.test(trimmed)) return null;
  const detail = trimmed.replace(/^yes\b[\s:,.-]*/i, "").trim();
  return detail || "Yes";
}
