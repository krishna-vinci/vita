import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Resume } from "@vita/shared";
import { loadTemplate } from "./templates";
import { renderTex } from "./tex";

const execute = promisify(execFile);

async function copyTrustedAssets(source: string, target: string): Promise<void> {
  if (!(await lstat(source)).isDirectory()) throw new Error("Template assets must be a directory without symlinks");
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to);
      await copyTrustedAssets(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to);
    } else {
      throw new Error(`Non-regular template asset or symlink: ${entry.name}`);
    }
  }
}

// Only bundled, trusted templates may use this network-enabled cache warm-up.
export async function warmTemplateCache(templatesDir: string): Promise<void> {
  for (const entry of await readdir(templatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const tpl = await loadTemplate([templatesDir], entry.name);
    // Letter templates are warmed by the letter pipeline's own sample (same packages as Rover Base).
    if (tpl.meta.kind !== "resume") continue;
    const resume = Resume.parse({
      id: "sample",
      kind: "master",
      parent: null,
      template: tpl.meta.id,
      header: {
        name: "Alex Example",
        headline: "Coordinator",
        contact: [{ label: "Email", value: "alex@example.test" }],
      },
      sections: [
        { id: "summary", title: "Summary", kind: "summary", text: "Clear communication and careful planning." },
        {
          id: "experience",
          title: "Experience",
          kind: "entries",
          items: [
            {
              id: "role",
              title: "Example Cooperative",
              subtitle: "Coordinator",
              period: "2024–2026",
              location: "Example City",
              bullets: [
                {
                  id: "sample-bullet",
                  text: "Organised records and documented the review process.",
                  claims: ["sample-records"],
                },
              ],
            },
          ],
        },
        {
          id: "skills",
          title: "Skills",
          kind: "list",
          items: [
            { id: "planning", title: "Planning" },
            {
              id: "coordination",
              title: "Coordination",
              bullets: [
                { id: "sample-notes", text: "Documented clear notes and review steps.", claims: ["sample-notes"] },
              ],
            },
          ],
        },
        { id: "notes", title: "Notes", kind: "text", text: "Available for local assignments." },
      ],
    });
    const dir = await mkdtemp(join(tmpdir(), "vita-warm-"));
    try {
      await copyTrustedAssets(tpl.dir, dir);
      await rm(join(dir, "main.pdf"), { force: true });
      await writeFile(join(dir, "main.tex"), renderTex(resume, tpl));
      await execute("tectonic", ["-X", "compile", "main.tex"], {
        cwd: dir,
        timeout: 300_000,
        maxBuffer: 20 * 1024 * 1024,
      });
      if (!(await lstat(join(dir, "main.pdf"))).isFile()) throw new Error("Cache warm-up did not produce a PDF");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
