import {
  type CheckNote,
  type Finding,
  type JobAnalysis,
  type RenderCheck,
  type Resume,
  type Review,
  visibleBullets,
} from "@vita/shared";
import { requirementCoveredByText } from "./coverage.js";

export { keywordMatches } from "./coverage.js";

export function evaluateDone(input: {
  resume: Resume;
  lint: Finding[];
  checks: CheckNote[];
  analysis: JobAnalysis;
  gaps: string[];
  render: RenderCheck | null;
  overrides: Review["overrides"];
}): { done: boolean; blocking: string[]; suggestions: string[] } {
  const suggestions: string[] = [];
  const blocking = input.lint
    .filter((note) => note.severity === "block")
    .map((note) => `${note.rule}: ${note.message}`);
  const bullets = visibleBullets(input.resume);
  // Must-haves can be met anywhere a reader sees them: bullets, skills lists, titles, summaries.
  const visibleText = input.resume.sections
    .filter((section) => !section.hidden)
    .flatMap((section) => [
      section.title,
      section.text ?? "",
      ...section.items
        .filter((item) => !item.hidden)
        .flatMap((item) => [
          item.title,
          item.subtitle ?? "",
          ...item.bullets.filter((b) => !b.hidden).map((b) => b.text),
        ]),
    ])
    .join("\n");
  const ids = new Set(bullets.map((bullet) => bullet.id));
  const overridden = new Set(input.overrides.map((override) => override.bulletId));
  for (const bullet of bullets) {
    if (overridden.has(bullet.id)) continue;
    const notes = input.checks.filter((note) => note.bulletId === bullet.id);
    if (notes.length === 0) blocking.push(`Unchecked bullet: ${bullet.id}`);
  }
  for (const note of input.checks) {
    if (ids.has(note.bulletId) && !overridden.has(note.bulletId) && note.verdict !== "supported") {
      blocking.push(`${note.verdict}: ${note.bulletId}: ${note.reason}`);
    }
  }
  for (const requirement of input.analysis.requirements) {
    if (requirement.importance !== "must") continue;
    const gap = input.gaps.some((value) => value === requirement.id || value.startsWith(`${requirement.id}:`));
    const covered = requirementCoveredByText(visibleText, requirement);
    if (!gap && !covered) suggestions.push(`Uncovered must-have: ${requirement.id}: ${requirement.text}`);
  }
  const render = input.render;
  if (render === null) blocking.push("PDF compilation and text extraction required.");
  else {
    if (!render.ok || render.pages < 1 || render.missingBullets.length || render.outOfOrder.length) {
      blocking.push("PDF failed compilation, text extraction or reading-order checks.");
    }
    if (render.maxPages !== undefined && render.pages > render.maxPages)
      blocking.push(`PDF exceeds ${render.maxPages} pages.`);
  }
  return { done: blocking.length === 0, blocking: [...new Set(blocking)], suggestions };
}
