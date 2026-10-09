import { createHash } from "node:crypto";
import { AnswerMetricRequest, DismissMetricRequest, type Evidence, ItemMeta, SourceProposal } from "@vita/shared";
import { parseDocument, stringify } from "yaml";
import { normalizeNumber } from "../lint/index.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { parseProjects, readAnchor, writeAnchor } from "../source/index.js";
import { bulletText, fenceEnd, fenceStart, heading, sourceLines, uniqueId } from "../source/markdown.js";
import { commitPaths, FileLocks, readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { dismissedPath, questionsForSnapshot, readDismissed } from "./questions.js";

export class MetricInterviewError extends Error {
  constructor(
    public readonly code: "invalid-question" | "invalid-claim" | "source-format",
    message: string,
  ) {
    super(message);
    this.name = "MetricInterviewError";
  }
}

const dismissals = new FileLocks();

function metricValues(answer: string): string[] {
  // Record every attested number, including the dates and versions lint exempts.
  const numbers =
    /[$€£₹]?[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\.\d+)(?:[kMB](?![\p{L}\p{N}_]))?(?:[ \t]*(?:percent\b|%|[x×](?![\p{L}\p{N}_])))?/giu;
  const values = new Map<string, string>();
  for (const match of answer.matchAll(numbers)) {
    let raw = match[0].trim();
    if (/^[+-]/.test(raw) && match.index > 0 && /[\p{L}\p{N}_%×]/u.test(answer[match.index - 1] ?? ""))
      raw = raw.slice(1);
    const normalized = normalizeNumber(raw);
    if (!values.has(normalized)) values.set(normalized, raw);
  }
  return [...values.values()];
}

export async function answerMetric(ws: WorkspaceHandle, input: AnswerMetricRequest): Promise<SourceProposal> {
  const { questionId, answer, claimId } = AnswerMetricRequest.parse(input);
  const before = await readText(ws.root, "projects.md");
  const question = (await questionsForSnapshot(ws, before)).find((entry) => entry.id === questionId);
  if (!question)
    throw new MetricInterviewError("invalid-question", "Question is unavailable. Reload the metric questions.");
  const { doc, issues } = parseProjects(before);
  const itemIndex = doc.items.findIndex((entry) => entry.slug === question.itemSlug);
  const item = doc.items[itemIndex];
  if (!item) throw new MetricInterviewError("invalid-question", "Question item no longer exists.");
  const endLine = doc.items[itemIndex + 1]?.line ?? Number.POSITIVE_INFINITY;
  if (issues.some((issue) => issue.line >= item.line && issue.line < endLine))
    throw new MetricInterviewError("source-format", "Fix the item's YAML before recording a metric answer.");
  const chosen = claimId === undefined ? undefined : item.claims.find((claim) => claim.id === claimId);
  if (claimId !== undefined && !chosen)
    throw new MetricInterviewError("invalid-claim", "Choose a claim belonging to this question's item.");
  const usedClaims = new Set(doc.items.flatMap((entry) => entry.claims.map((claim) => claim.id)));
  const usedEvidence = new Set(doc.items.flatMap((entry) => entry.meta.evidence.map((evidence) => evidence.id)));
  const targetId = chosen?.id ?? uniqueId(`${item.slug}-${questionId}`, usedClaims);
  const evidenceId = uniqueId(`ev-${questionId}`, usedEvidence);
  const today = new Date();
  const at = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const evidence: Evidence = { id: evidenceId, kind: "statement", at, text: answer };
  const metrics = metricValues(answer).map((value) => ({ value, kind: "measured" as const, evidence: [evidenceId] }));
  const lines = sourceLines(before);
  const start = item.line - 1;
  const end = Number.isFinite(endLine) ? endLine - 1 : lines.length;
  const section = lines.slice(start, end);
  const newline = section.find((line) => line.ending)?.ending ?? "\n";
  let metaStart = -1;
  let metaEnd = -1;
  let claimsHeading = -1;
  let chosenLine = -1;
  let claimIndex = 0;
  let mode = "";
  for (let index = 1; index < section.length; index++) {
    const text = section[index]?.text ?? "";
    const fence = fenceStart(text);
    if (fence) {
      const opening = index;
      while (++index < section.length && !fenceEnd(section[index]?.text ?? "", fence.marker)) {}
      if (index >= section.length)
        throw new MetricInterviewError(
          "source-format",
          "Close the item's fenced block before recording a metric answer.",
        );
      if (fence.info === "yaml" && metaStart < 0) {
        metaStart = opening;
        metaEnd = index;
      }
      continue;
    }
    const subsection = heading(text, 3);
    if (subsection !== null) {
      mode = subsection;
      if (subsection === "Claims" && claimsHeading < 0) claimsHeading = index;
    } else if (mode === "Claims") {
      const bullet = bulletText(text);
      if (bullet?.trim() && readAnchor(bullet).text) {
        if (item.claims[claimIndex]?.id === chosen?.id) chosenLine = index;
        claimIndex++;
      }
    }
  }
  if (metaStart >= 0 && metaEnd >= section.length)
    throw new MetricInterviewError("source-format", "Close the item's YAML fence before recording a metric answer.");
  const yaml = parseDocument(
    metaStart < 0
      ? "evidence: []"
      : section
          .slice(metaStart + 1, metaEnd)
          .map((line) => line.text)
          .join("\n"),
  );
  if (yaml.has("evidence")) yaml.addIn(["evidence"], evidence);
  else yaml.set("evidence", [evidence]);
  yaml.setIn(["metric_answers", questionId], evidenceId);
  if (metrics.length) yaml.setIn(["metrics", targetId], [...(chosen?.metrics ?? []), ...metrics]);
  ItemMeta.parse(yaml.toJS());
  // Apply line edits from the bottom upward so source positions remain valid.
  const changes: { start: number; count: number; text: string[] }[] = [];
  if (chosen) {
    if (chosenLine < 0)
      throw new MetricInterviewError("source-format", "Cannot locate the chosen claim in the source.");
    const line = section[chosenLine]?.text ?? "";
    changes.push({
      start: chosenLine,
      count: 1,
      text: [
        writeAnchor(readAnchor(line).text, {
          claim: chosen.id,
          evidence: [...chosen.evidence, evidenceId],
        }),
      ],
    });
  } else {
    const text = writeAnchor(`- ${item.name}: ${answer.replace(/\s+/g, " ").trim()}`, {
      claim: targetId,
      evidence: [evidenceId],
    });
    changes.push({
      start: claimsHeading < 0 ? section.length : claimsHeading + 1,
      count: 0,
      text: claimsHeading < 0 ? ["### Claims", text] : [text],
    });
  }
  const metaLines = yaml.toString({ lineWidth: 0 }).trimEnd().split("\n");
  changes.push(
    metaStart < 0
      ? { start: 1, count: 0, text: ["```yaml", ...metaLines, "```"] }
      : { start: metaStart + 1, count: metaEnd - metaStart - 1, text: metaLines },
  );
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    if (change.start > 0 && !section[change.start - 1]?.ending) {
      const previous = section[change.start - 1];
      if (previous) previous.ending = newline;
    }
    const ending = change.count ? (section[change.start + change.count - 1]?.ending ?? newline) : newline;
    section.splice(
      change.start,
      change.count,
      ...change.text.map((text, index) => ({
        text,
        ending: index === change.text.length - 1 ? ending : newline,
      })),
    );
  }
  const after = [...lines.slice(0, start), ...section, ...lines.slice(end)]
    .map((line) => line.text + line.ending)
    .join("");
  return SourceProposal.parse({
    file: "projects",
    before,
    after,
    baseHash: createHash("sha256").update(before).digest("hex"),
    summary: `Record metric answer for ${item.name}`,
  });
}

export async function dismissMetric(ws: WorkspaceHandle, questionId: string): Promise<{ sha: string | null }> {
  DismissMetricRequest.parse({ questionId });
  const release = await dismissals.acquire(resolveInWorkspace(ws.root, dismissedPath), "dismissMetric");
  try {
    const dismissed = await readDismissed(ws);
    if (dismissed.includes(questionId)) return { sha: null };
    const questions = await questionsForSnapshot(ws, await readText(ws.root, "projects.md"));
    if (!questions.some((question) => question.id === questionId))
      throw new MetricInterviewError("invalid-question", "Question is unavailable. Reload the metric questions.");
    await writeTextAtomic(ws.root, dismissedPath, stringify([...dismissed, questionId], { lineWidth: 0 }));
    return { sha: await commitPaths(ws.root, [dismissedPath], "Dismiss metric question", "editor") };
  } finally {
    release();
  }
}
