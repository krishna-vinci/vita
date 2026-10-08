import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assignOutlineAnchors,
  commitPaths,
  ensureRepo,
  importLegacyProjects,
  readText,
  resolveInWorkspace,
  serializeProjects,
  writeTextAtomic,
} from "@vita/core";
import { Profile } from "@vita/shared";
import { parse, stringify } from "yaml";

export async function importCommand(
  dir: string,
  opts: { projects: string; outline?: string; name?: string; headline?: string; contact?: string[] },
): Promise<string[]> {
  const root = resolve(dir);
  const imported = importLegacyProjects(await readFile(resolve(opts.projects), "utf8"));
  const outline = opts.outline ? await readFile(resolve(opts.outline), "utf8") : await readText(root, "outline.md");
  const anchored = assignOutlineAnchors(outline);
  let profile: unknown;
  try {
    profile = parse(await readText(root, "profile.yaml"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const existing = Profile.parse(profile ?? { name: "", contact: [] });
  const updated = Profile.parse({
    ...existing,
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.headline === undefined ? {} : { headline: opts.headline }),
    ...(opts.contact === undefined
      ? {}
      : {
          contact: opts.contact.map((entry) => {
            const separator = entry.indexOf("=");
            if (separator < 1) throw new Error("Contact must use Label=value[=url]");
            const urlSeparator = entry.indexOf("=", separator + 1);
            return {
              label: entry.slice(0, separator),
              value: entry.slice(separator + 1, urlSeparator < 0 ? undefined : urlSeparator),
              ...(urlSeparator < 0 ? {} : { url: entry.slice(urlSeparator + 1) }),
            };
          }),
        }),
  });
  // Validate all destinations before changing source or profile files.
  resolveInWorkspace(root, "projects.md");
  resolveInWorkspace(root, "outline.md");
  resolveInWorkspace(root, "profile.yaml");
  await ensureRepo(root);
  await writeTextAtomic(root, "projects.md", serializeProjects(imported.doc));
  await writeTextAtomic(root, "outline.md", anchored.markdown);
  await writeTextAtomic(root, "profile.yaml", stringify(updated));
  await commitPaths(root, ["projects.md", "outline.md", "profile.yaml"], "Import source files", "importer");
  const report = [...imported.report, `Added ${anchored.added} outline anchors.`];
  for (const line of report) console.log(line);
  return report;
}
