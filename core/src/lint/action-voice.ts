import patterns from "./action-voice-patterns.json" with { type: "json" };

/** Shared by writer lint and proposal intake; titles are data, never regex syntax. */
export function actionVoiceProblem(text: string, titles: string[] = []): string | null {
  const line = text.trim();
  const subject = patterns.subjectOpeners.some((pattern) => new RegExp(pattern, "iu").test(line));
  const named = titles.filter(Boolean).some((title) => {
    const escaped = title.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}\\s+(?:${patterns.titleVerbs.join("|")})\\b`, "iu").test(line);
  });
  return subject || named
    ? "Use an action in implied first person (for example, Built, Added or Contributed), not a third-person description. Confirm ownership before choosing the verb and scope."
    : null;
}
