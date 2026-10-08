import type { Prep } from "@vita/shared";

export function renderPrepMarkdown(prep: Prep, flags: string[]): string {
  const lines = ["# Interview preparation", "", "## Questions", ""];
  for (const question of prep.questions) {
    lines.push(`### ${question.question}`, "", `Kind: ${question.kind}`, "", `Why: ${question.why}`, "");
    for (const point of question.talkingPoints) lines.push(`- ${point}`);
    lines.push("", `Claims: ${question.claimIds.join(", ") || "None; use only the job text."}`, "");
  }
  lines.push("## Story drafts", "");
  for (const story of prep.stories) {
    lines.push(
      `### ${story.title}`,
      "",
      `Situation: ${story.situation}`,
      "",
      `Task: ${story.task}`,
      "",
      `Action: ${story.action}`,
      "",
      `Claims: ${story.claimIds.join(", ")}`,
      "",
      `Result: ${story.result ?? "Fill in your actual result; no supported outcome is recorded."}`,
      "",
    );
  }
  lines.push("## Honest gap answers", "");
  for (const gap of prep.gaps) {
    lines.push(
      `### ${gap.requirementId}`,
      "",
      gap.honestAnswer,
      "",
      `Bridge: ${gap.bridge}`,
      "",
      `Plan: ${gap.plan}`,
      "",
    );
  }
  if (flags.length) lines.push("## Needs evidence", "", ...flags.map((flag) => `- ${flag}`), "");
  return `${lines.join("\n").trimEnd()}\n`;
}
