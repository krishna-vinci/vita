import { lstat } from "node:fs/promises";
import { type Bullet, type Item, type Resume, type Section, slugify } from "@vita/shared";
import { buildClaimIndex } from "../claims/index.js";
import { optionalText } from "../pipeline/context.js";
import { assignOutlineAnchors, parseOutline, parseProjects } from "../source/index.js";
import { resolveInWorkspace } from "../workspace/index.js";
import {
  bulletEditCommits,
  generationBaseline,
  isAfter,
  sourceAt,
  sourceHistory,
  sourceWorkingChanges,
} from "./history.js";

type Sources = Pick<Awaited<ReturnType<typeof sourceAt>>, "index" | "outline">;

function basis(sources: Sources, bullet: Bullet, section: Section, item: Item): string {
  const ids = new Set(bullet.claims);
  // Older summary bullets sometimes cite an unrelated experience claim.
  if (section.kind === "summary") ids.add("outline.summary");
  const sections = sources.outline.sections.filter(
    (source) =>
      (section.kind !== "summary" &&
        (slugify(source.title) === item.source ||
          source.entries.some((entry) => slugify(entry.title) === item.source))) ||
      [...source.bullets, ...source.entries.flatMap((entry) => entry.bullets)].some(
        (claim) => claim.claimId && ids.has(claim.claimId),
      ),
  );
  return JSON.stringify([
    [...ids].sort().map((id) => [id, sources.index.claims.get(id)?.text]),
    sections.map((source) => {
      const end = sources.outline.sections.find((entry) => entry.line > source.line)?.line;
      return sources.outline.raw
        .split(/\r?\n/)
        .slice(source.line - 1, end === undefined ? undefined : end - 1)
        .join("\n");
    }),
  ]);
}

/** A single history reader per resume; snapshots are shared by all its bullets. */
export async function bulletFreshness(root: string, resume: Resume) {
  try {
    await lstat(resolveInWorkspace(root, ".git"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return async () => false;
    throw error;
  }
  const prefix = `${resume.kind === "job" ? "applications" : "resumes"}/${resume.id}`;
  const baseline = await generationBaseline(root, prefix);
  const history = await sourceHistory(root);
  const timestamps = resume.sections.some((section) =>
    section.items.some((item) => item.bullets.some((bullet) => bullet.lockedAt || bullet.editedAt)),
  );
  const edits = timestamps ? await bulletEditCommits(root, prefix) : new Map<string, string>();
  const workingChanges = await sourceWorkingChanges(root);
  const comparisons = new Map<string, Promise<boolean>>();
  const after = (sha: string, checkpoint: string) => {
    const key = `${sha}:${checkpoint}`;
    let value = comparisons.get(key);
    if (!value) {
      value = isAfter(root, sha, checkpoint);
      comparisons.set(key, value);
    }
    return value;
  };
  const snapshots = new Map<string, Promise<Awaited<ReturnType<typeof sourceAt>>>>();
  const snapshot = (sha: string) => {
    let value = snapshots.get(sha);
    if (!value) {
      value = sourceAt(root, sha);
      snapshots.set(sha, value);
    }
    return value;
  };
  const outline = parseOutline(assignOutlineAnchors((await optionalText(root, "outline.md")) ?? "").markdown);
  const current: Sources = {
    outline,
    index: buildClaimIndex(parseProjects((await optionalText(root, "projects.md")) ?? "").doc, outline),
  };
  return async (bullet: Bullet, section: Section, item: Item): Promise<boolean> => {
    const timestamp = [bullet.lockedAt, bullet.editedAt]
      .filter((at): at is string => !!at)
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1);
    const editCommit = timestamp ? edits.get(`${bullet.id}:${timestamp}`) : undefined;
    if (!timestamp && !baseline) return false;
    for (const [position, entry] of history.entries()) {
      const sameSecond =
        timestamp && Math.floor(Date.parse(entry.at) / 1000) === Math.floor(Date.parse(timestamp) / 1000);
      const newer =
        sameSecond && editCommit
          ? await after(entry.sha, editCommit)
          : timestamp
            ? Date.parse(entry.at) > Date.parse(timestamp)
            : await after(entry.sha, baseline as string);
      if (!newer && !(position === 0 && workingChanges)) break;
      const next = await snapshot(entry.sha);
      // Uncommitted edits are newer than the last committed snapshot.
      if (
        position === 0 &&
        workingChanges &&
        basis(current, bullet, section, item) !== basis(next, bullet, section, item)
      )
        return true;
      if (!newer) break;
      const olderEntry = history[position + 1];
      const older: Sources = olderEntry
        ? await snapshot(olderEntry.sha)
        : {
            outline: parseOutline(""),
            index: buildClaimIndex(parseProjects("").doc, parseOutline("")),
          };
      if (basis(next, bullet, section, item) !== basis(older, bullet, section, item)) return true;
    }
    return false;
  };
}

export async function releaseStaleBullets(root: string, seed: Resume) {
  const resume = structuredClone(seed);
  if (
    !resume.sections.some((section) =>
      section.items.some((item) => item.bullets.some((bullet) => bullet.locked || bullet.origin === "user")),
    )
  )
    return { resume, released: [] };
  const newer = await bulletFreshness(root, resume);
  const hasSummary = !!parseOutline((await optionalText(root, "outline.md")) ?? "").summary;
  const released: { bullet: Bullet; section: Section; item: Item }[] = [];
  for (const section of resume.sections)
    for (const item of section.items)
      for (const bullet of item.bullets) {
        if (!(bullet.locked || bullet.origin === "user")) continue;
        if (await newer(bullet, section, item)) {
          released.push({ bullet: structuredClone(bullet), section, item });
          bullet.locked = false;
          bullet.origin = "ai";
          delete bullet.lockedAt;
          delete bullet.editedAt;
          delete bullet.override;
        } else {
          bullet.locked = true;
          if (section.kind === "summary" && hasSummary) bullet.claims = ["outline.summary"];
        }
      }
  return { resume, released };
}
