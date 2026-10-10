import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resume } from "@vita/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as compile from "./compile";
import { readBundledTemplatePreview, renderTemplatePreview } from "./preview";
import { loadTemplate } from "./templates";
import * as tex from "./tex";
import * as textcheck from "./textcheck";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-preview-test-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("rasterizes a checked developer fixture to a first-page PNG at 150 dpi", async (context) => {
  if (!(await compile.tectonicAvailable())) {
    console.warn("Skipping preview rasterization test: tectonic is not on PATH.");
    context.skip();
  }
  const resume = Resume.parse(
    JSON.parse(
      await readFile(new URL("../../../fixtures/developer/resumes/master/resume.json", import.meta.url), "utf8"),
    ),
  );
  const template = await loadTemplate([fileURLToPath(new URL("../../../templates/", import.meta.url))], "rover-base");
  const png = await renderTemplatePreview(resume, template, 1);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(1241);
  expect(png.readUInt32BE(20)).toBe(1754);
}, 60_000);

it("reads only regular bundled previews and rejects traversal and symlink escapes", async () => {
  await mkdir(join(root, "templates/example"), { recursive: true });
  const templates = join(root, "templates");
  const png = Buffer.from("preview bytes");
  await writeFile(join(templates, "example/preview.png"), png);
  expect(await readBundledTemplatePreview(templates, "example")).toEqual(png);
  expect(await readBundledTemplatePreview(templates, "missing")).toBeNull();
  await expect(readBundledTemplatePreview(templates, "../example")).rejects.toThrow();
  await rm(join(templates, "example/preview.png"));
  await writeFile(join(root, "outside.png"), png);
  await symlink(join(root, "outside.png"), join(templates, "example/preview.png"));
  expect(await readBundledTemplatePreview(templates, "example")).toBeNull();
  await symlink(root, join(templates, "linked"));
  expect(await readBundledTemplatePreview(templates, "linked")).toBeNull();
});

it("refuses to rasterize a preview with missing bullets or page overflow", async () => {
  vi.spyOn(tex, "renderTex").mockReturnValue("safe tex");
  vi.spyOn(compile, "compileTex").mockResolvedValue({ pdf: Buffer.from("%PDF-test"), log: "" });
  const extraction = vi.spyOn(textcheck, "pdfText").mockResolvedValue({ text: "", pages: 1 });
  const resume = Resume.parse({
    id: "sample",
    kind: "master",
    parent: null,
    template: "example",
    header: { name: "Alex" },
    sections: [
      {
        id: "s",
        title: "Summary",
        kind: "summary",
        items: [{ id: "i", title: "", bullets: [{ id: "b", text: "Visible text." }] }],
      },
    ],
  });
  const template = {
    dir: root,
    meta: { id: "example", name: "Example", kind: "resume" as const, page: "a4" as const, knobs: {}, supports: [] },
  };
  await expect(renderTemplatePreview(resume, template, 1)).rejects.toThrow("render check");
  extraction.mockResolvedValue({ text: "Visible text.", pages: 2 });
  await expect(renderTemplatePreview(resume, template, 1)).rejects.toThrow("render check");
});
