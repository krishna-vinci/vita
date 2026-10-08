import { resolve } from "node:path";
import { parseOutline, parseProjects, readText } from "@vita/core";
import { Claim, ItemMeta, Resume, Slug } from "@vita/shared";

export async function checkCommand(
  dir: string,
  opts: { resume?: string } = {},
): Promise<{ ok: boolean; issues: string[] }> {
  const root = resolve(dir);
  const id = Slug.parse(opts.resume ?? "master");
  const issues: string[] = [];
  const claims = new Set<string>();
  try {
    const outline = parseOutline(await readText(root, "outline.md"));
    for (const section of outline.sections) {
      for (const bullet of [...section.bullets, ...section.entries.flatMap((entry) => entry.bullets)]) {
        if (bullet.claimId) claims.add(bullet.claimId);
      }
    }
  } catch (error) {
    issues.push(`outline.md: ${(error as Error).message}`);
  }
  try {
    const projects = parseProjects(await readText(root, "projects.md"));
    issues.push(...projects.issues.map((issue) => `projects.md:${issue.line}: ${issue.message}`));
    for (const item of projects.doc.items) {
      ItemMeta.parse(item.meta);
      for (const claim of item.claims) {
        Claim.parse(claim);
        claims.add(claim.id);
      }
    }
  } catch (error) {
    issues.push(`projects.md: ${(error as Error).message}`);
  }
  try {
    const resume = Resume.parse(JSON.parse(await readText(root, `resumes/${id}/resume.json`)));
    for (const section of resume.sections) {
      for (const item of section.items) {
        for (const bullet of item.bullets) {
          if (!bullet.claims.length) issues.push(`Bullet ${bullet.id}: no claim IDs`);
          for (const claim of bullet.claims) {
            if (!claims.has(claim)) issues.push(`Bullet ${bullet.id}: unknown claim ${claim}`);
          }
        }
      }
    }
  } catch (error) {
    issues.push(`resumes/${id}/resume.json: ${(error as Error).message}`);
  }
  for (const issue of issues) console.log(issue);
  if (!issues.length) console.log("Check passed.");
  return { ok: issues.length === 0, issues };
}
