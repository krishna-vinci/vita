import { JobAnalysis, PromoteAnswersRequest, Slug, type SourceProposal } from "@vita/shared";
import { parse as parseYaml, stringify } from "yaml";
import { answerClaimId, loadContext } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { fileHash, readText } from "../workspace/index.js";
import { ChatConflictError } from "./context.js";

/** Append a separate statement-evidence item; existing user-written source bytes are preserved. */
export async function proposeAnswerPromotion(
  ws: WorkspaceHandle,
  applicationId: string,
  input: { requirementIds?: string[] } = {},
  now = new Date(),
): Promise<SourceProposal> {
  Slug.parse(applicationId);
  const request = PromoteAnswersRequest.parse(input);
  const rel = `applications/${applicationId}/meta.yaml`;
  const metaText = await readText(ws.root, rel);
  const meta = parseYaml(metaText) ?? {};
  const analysis = JobAnalysis.parse(
    JSON.parse(await readText(ws.root, `applications/${applicationId}/analysis.json`)),
  );
  const baseHash = await fileHash(ws.root, "projects.md");
  const ctx = await loadContext(ws);
  try {
    const selected = Object.keys(meta.answers ?? {}).filter(
      (id) => !request.requirementIds || request.requirementIds.includes(id),
    );
    const claims = selected
      .map((id) => ctx.index.claims.get(answerClaimId(applicationId, id)))
      .filter((claim) => claim !== undefined);
    if (!claims.length) throw new Error("No yes answers are available to promote");
    if (!baseHash || !ctx.projectsText) throw new Error("projects.md must contain source text before promotion");
    const evidence = claims.flatMap((claim) =>
      claim.evidence.map((entry) => ({ ...entry, at: now.toISOString().slice(0, 10) })),
    );
    // Markdown control characters in answers cannot create additional sections or anchors.
    const safeText = (text: string) =>
      text
        .replace(/[\r\n]+/g, " ")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const block = [
      `## Answers from ${safeText(analysis.company || applicationId)} (${applicationId})`,
      "```yaml",
      stringify({ kind: "project", evidence }, { lineWidth: 0 }).trimEnd(),
      "```",
      "### Claims",
      ...claims.map(
        (claim) =>
          `- ${safeText(claim.text)} <!-- c:${claim.id} ev:${claim.evidence.map((entry) => entry.id).join(",")} -->`,
      ),
      "### Limits",
      "- User-attested answers; do not infer additional experience or outcomes.",
      "### Variants",
      "",
    ].join("\n");
    if ((await fileHash(ws.root, "projects.md")) !== baseHash || (await readText(ws.root, rel)) !== metaText)
      throw new ChatConflictError("stale-hash", "Sources or answers changed while building the proposal.");
    if (claims.some((claim) => ctx.projectsText.includes(`c:${claim.id} `)))
      throw new Error("These answers have already been promoted");
    return {
      file: "projects",
      before: ctx.projectsText,
      after: `${ctx.projectsText}\n\n${block}`,
      summary: `Save answers to profile: ${applicationId}`,
      baseHash,
    };
  } finally {
    ctx.search.close();
  }
}
