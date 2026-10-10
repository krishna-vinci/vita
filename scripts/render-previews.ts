import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTemplate, renderTemplatePreview } from "../core/src/render/index.js";
import { Resume } from "../shared/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const templatesDir = join(root, "templates");
const fixture = Resume.parse(
  JSON.parse(await readFile(join(root, "fixtures/developer/resumes/master/resume.json"), "utf8")),
);
for (const entry of (await readdir(templatesDir, { withFileTypes: true })).sort((a, b) =>
  a.name.localeCompare(b.name),
)) {
  if (!entry.isDirectory()) continue;
  const template = await loadTemplate([templatesDir], entry.name);
  const png = await renderTemplatePreview({ ...fixture, template: template.meta.id }, template, 1);
  await writeFile(join(template.dir, "preview.png"), png);
  console.log(`${template.meta.id}: preview.png (150 dpi)`);
}
