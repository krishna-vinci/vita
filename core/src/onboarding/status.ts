import { type OnboardingStatus, Profile } from "@vita/shared";
import { parse } from "yaml";
import { optionalText } from "../pipeline/context.js";
import type { WorkspaceHandle } from "../pipeline/types.js";
import { parseProjects } from "../source/index.js";
import { fileHash } from "../workspace/index.js";
import { starterOutline } from "../workspace/init.js";

const body = (text: string) =>
  text
    .replace(/^# [^\n]*\n/, "")
    .replace(/\s+/g, " ")
    .trim();

export async function onboardingStatus(ws: WorkspaceHandle): Promise<OnboardingStatus> {
  const [profile, outline, projects, master] = await Promise.all([
    optionalText(ws.root, "profile.yaml"),
    optionalText(ws.root, "outline.md"),
    optionalText(ws.root, "projects.md"),
    fileHash(ws.root, "resumes/master/resume.json"),
  ]);
  return {
    hasProfileName: profile !== undefined && !!Profile.parse(parse(profile)).name.trim(),
    outlineIsStarter: outline === undefined || body(outline) === body(starterOutline("")),
    projectCount: parseProjects(projects ?? "").doc.items.length,
    masterExists: master !== null,
  };
}
