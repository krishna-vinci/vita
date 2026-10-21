import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { BaseConfig, type Resume, Slug, type TexConflict, type TexView } from "@vita/shared";
import { applyPatch, createTwoFilesPatch, parsePatch } from "diff";
import { parse } from "yaml";
import { readText, resolveInWorkspace, writeTextAtomic } from "../workspace/index.js";
import { CompileError } from "./compile.js";
import type { RenderSources } from "./links.js";
import { prescanTex } from "./prescan.js";
import type { LoadedTemplate } from "./templates.js";
import { renderTex } from "./tex.js";
import { checkRender, normalizeForMatch } from "./textcheck.js";

export function resumePrefix(resume: Resume): string {
  return `${resume.kind === "job" ? "applications" : "resumes"}/${Slug.parse(resume.id)}`;
}
export function texHash(generated: string, patch: string | null): string {
  return createHash("sha256")
    .update(generated)
    .update("\0")
    .update(patch ?? "")
    .digest("hex");
}
export function createTexPatch(generated: string, tex: string): string {
  return createTwoFilesPatch("resume.tex", "resume.tex", generated, tex, "", "", { context: 3 });
}
export function applyTexPatch(generated: string, patch: string | null): TexView {
  let patched = generated;
  let conflict: TexConflict | undefined;
  if (patch) {
    const parsed = parsePatch(patch);
    if (parsed.length !== 1) throw new CompileError("Expected one resume.tex patch");
    const entry = parsed[0];
    if (!entry) throw new CompileError("Missing resume.tex patch");
    const applied = applyPatch(generated, entry);
    if (applied === false) {
      const failedHunks = entry.hunks.filter((hunk) => applyPatch(generated, { ...entry, hunks: [hunk] }) === false);
      conflict = { failedHunks: failedHunks.length ? failedHunks : entry.hunks };
    } else patched = applied;
  }
  const issues = prescanTex(patched);
  if (issues.length)
    throw new CompileError(
      "Unsafe LaTeX patch",
      issues.map((issue) => `resume.tex:${issue.line}: ${issue.message}`).join("\n"),
    );
  return { generated, patched, patch, hash: texHash(generated, patch), ...(conflict ? { conflict } : {}) };
}
export async function storedTexPatch(
  root: string,
  resume: Resume,
  generated: string,
  persistConflict = true,
): Promise<TexView> {
  const prefix = resumePrefix(resume);
  let patch: string | null = null;
  try {
    patch = await readText(root, `${prefix}/tex.patch`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const view = applyTexPatch(generated, patch);
  if (persistConflict) {
    if (view.conflict)
      await writeTextAtomic(root, `${prefix}/tex.conflict.json`, `${JSON.stringify(view.conflict, null, 2)}\n`);
    else await rm(resolveInWorkspace(root, `${prefix}/tex.conflict.json`), { force: true });
  }
  return view;
}

// Compare list content as well as the extracted PDF: ordinary footer text is allowed,
// while a TeX patch cannot introduce an unchecked list item. Layout commands do not count as text.
export function checkPatchedRender(
  resume: Resume,
  extracted: { text: string; pages: number },
  maxPages: number | undefined,
  generated: string,
  patched: string,
) {
  const result = checkRender(resume, extracted, maxPages);
  if (generated === patched) return result;
  const items = (tex: string) =>
    [
      ...tex
        .replace(/(?<!\\)%[^\r\n]*/g, "")
        .matchAll(/\\item\b\s*([\s\S]*?)(?=\\item\b|\\end\{(?:itemize|enumerate|description)\})/g),
    ].map((match) =>
      normalizeForMatch(
        (match[1] ?? "")
          .replace(/\\(?:vspace|hspace|kern|vskip)\*?\{[^}]*\}/g, "")
          .replace(/\\[a-zA-Z]+\*?/g, "")
          .replace(/[{}]/g, ""),
      ).replace(/\s/g, ""),
    );
  const expected = items(generated);
  const unexpectedItems: string[] = [];
  for (const item of items(patched)) {
    const index = expected.indexOf(item);
    if (index < 0) unexpectedItems.push(item);
    else expected.splice(index, 1);
  }
  return unexpectedItems.length ? { ...result, unexpectedItems, ok: false } : result;
}

/** Workspace render entry: base style defaults, generation, then the person's final touches. */
export async function renderStoredTex(
  root: string,
  resume: Resume,
  template: LoadedTemplate,
  sources: RenderSources = {},
  persistConflict = true,
  ignorePatch = false,
): Promise<TexView> {
  const baseId = resume.kind === "base" ? resume.id : resume.kind === "job" ? resume.parent : null;
  let layout = resume.layout;
  if (baseId) {
    let text: string | undefined;
    try {
      text = await readText(root, `resumes/${Slug.parse(baseId)}/base.yaml`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (text) layout = { ...BaseConfig.parse(parse(text)).layout, ...layout };
  }
  const generated = renderTex({ ...resume, layout }, template, sources);
  return ignorePatch ? applyTexPatch(generated, null) : storedTexPatch(root, resume, generated, persistConflict);
}
