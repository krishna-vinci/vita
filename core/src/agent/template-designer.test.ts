import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as render from "../render/index.js";
import { editableTemplate, forkTemplate, sampleResume } from "../templates/edit.js";
import { ensureRepo, writeTextAtomic } from "../workspace/index.js";
import { ModelsConfig, resolveRoleModel } from "./models.js";
import { createGenerationRuntime } from "./roles.js";
import { proposeTemplateDesign } from "./template-designer.js";

const bundledDir = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let close: (() => Promise<void>) | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vita-designer-"));
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  await ensureRepo(root);
  await forkTemplate({ root, bundledDir }, "rover-base", "Design test");
  for (const file of ["instructions.md", "memory.md", "outline.md", "projects.md", "resumes/master/resume.json"])
    await writeTextAtomic(root, file, "PRIVATE_RESUME_FACTS_NEVER_SEND");
});
afterEach(async () => {
  await close?.();
  close = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("faux-submits a validated diff and fictional preview without reading resume data, saving source or exposing read tools", async () => {
  const current = await editableTemplate({ root, bundledDir }, "design-test");
  const source = current.source.replace("\\end{document}", "\\vspace{1pt}\n\\end{document}");
  const created = await createGenerationRuntime([{ tool: "submit_design", arguments: { source } }]);
  close = created.close;
  await created.runtime.refresh({ allowNetwork: false });
  const prompts: string[] = [];
  const original = created.runtime.streamSimple.bind(created.runtime);
  created.runtime.streamSimple = (model, context, options) => {
    prompts.push(JSON.stringify(context));
    return original(model, context, options);
  };
  vi.spyOn(render, "compileTex").mockResolvedValue({ pdf: Buffer.from("sample preview"), log: "compile ok" });
  const sample = await sampleResume();
  vi.spyOn(render, "pdfText").mockResolvedValue({
    text: sample.sections
      .flatMap((section) => section.items.flatMap((item) => item.bullets.map((bullet) => bullet.text)))
      .join("\n"),
    pages: 1,
  });
  const result = await proposeTemplateDesign({ root, bundledDir }, "design-test", "Add a little spacing", {
    runtime: created.runtime,
    models: ModelsConfig.parse(created.models),
    retry: { enabled: false },
  });
  expect(result).toMatchObject({ source, baseHash: current.hash, log: "compile ok" });
  expect(result.usage).toEqual([expect.objectContaining({ role: "template-designer", model: "faux/default" })]);
  expect(result.diff).toContain("+\\vspace{1pt}");
  expect(result.previewUrl).toMatch(/adopted.pdf$/);
  expect(await readFile(join(root, "templates/design-test/main.tex.njk"), "utf8")).toBe(current.source);
  expect(prompts.join("\n")).not.toContain("PRIVATE_RESUME_FACTS_NEVER_SEND");
  expect(prompts.join("\n")).not.toMatch(
    /"name":"(?:read_resume|read_outline|read_projects|search_evidence|bash|read)"/,
  );
  const config = ModelsConfig.parse({ default: "faux/default", roles: { "template-adopter": "faux/adopter" } });
  expect(resolveRoleModel(config, "template-designer")).toBe("faux/adopter");
  expect(
    resolveRoleModel(
      { ...config, roles: { ...config.roles, "template-designer": "faux/design" } },
      "template-designer",
    ),
  ).toBe("faux/design");
});

it("rejects unsafe designer output before sandbox compilation and never saves it", async () => {
  const current = await editableTemplate({ root, bundledDir }, "design-test");
  const source = `${current.source}\n\\write18{evil}`;
  const created = await createGenerationRuntime([{ tool: "submit_design", arguments: { source } }]);
  close = created.close;
  await created.runtime.refresh({ allowNetwork: false });
  const compile = vi.spyOn(render, "compileTex");
  await expect(
    proposeTemplateDesign({ root, bundledDir }, "design-test", "Try an unsafe edit", {
      runtime: created.runtime,
      models: ModelsConfig.parse(created.models),
      retry: { enabled: false },
    }),
  ).rejects.toMatchObject({ name: "CompileError", log: expect.stringContaining("Unsafe command") });
  expect(compile).not.toHaveBeenCalled();
  expect((await editableTemplate({ root, bundledDir }, "design-test")).source).toBe(current.source);
});

it("rejects a syntactically safe proposal when sandbox compilation fails", async () => {
  const current = await editableTemplate({ root, bundledDir }, "design-test");
  const source = current.source.replace("\\end{document}", "\\undefinedlayoutcommand\n\\end{document}");
  const created = await createGenerationRuntime([{ tool: "submit_design", arguments: { source } }]);
  close = created.close;
  await created.runtime.refresh({ allowNetwork: false });
  vi.spyOn(render, "compileTex").mockRejectedValue(
    new render.CompileError("Invalid LaTeX", "main.tex:120: Undefined control sequence"),
  );
  await expect(
    proposeTemplateDesign({ root, bundledDir }, "design-test", "Change spacing", {
      runtime: created.runtime,
      models: ModelsConfig.parse(created.models),
      retry: { enabled: false },
    }),
  ).rejects.toMatchObject({ log: expect.stringContaining("Undefined control sequence") });
  expect((await editableTemplate({ root, bundledDir }, "design-test")).source).toBe(current.source);
});
