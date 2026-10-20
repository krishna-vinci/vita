import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AdoptionProposal, type RenderCheck, Resume } from "@vita/shared";
import { Type } from "typebox";
import { z } from "zod";
import { buildSystemPrompt, type RoleSpec, runRole, wrapUntrusted } from "../agent/index.js";
import type { PipelineDeps, WorkspaceHandle } from "../pipeline/types.js";
import { CompileError, checkRender, compileTex, pdfText, renderTex } from "../render/index.js";
import { commitPaths, readText, writeFileAtomic, writeTextAtomic } from "../workspace/index.js";
import { compileOriginal, scanUpload, warmUploadedPackages } from "./compile.js";
import { artifacts, incoming, loadUpload, templateLocks, templatePath, type UploadedTemplate } from "./storage.js";
import { validateProposal } from "./validation.js";
import { TemplateError } from "./zip.js";

const output = AdoptionProposal.omit({ id: true });
export const templateAdopterRole: RoleSpec<z.infer<typeof output>> = {
  name: "template-adopter",
  skills: ["adopt-template"],
  readTools: [],
  submitTool: {
    name: "submit_template",
    description: "Propose a template contract preserving the original layout.",
    parameters: Type.Unsafe(z.toJSONSchema(output, { io: "input" })),
    output,
  },
};
interface SavedProposal {
  proposal: AdoptionProposal;
  uploadHash: string;
  renderCheck: RenderCheck;
}
async function uploadHash(upload: UploadedTemplate): Promise<string> {
  const hash = createHash("sha256");
  for (const name of upload.files) {
    const bytes = await readFile(join(upload.dir, name));
    hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`).update(bytes);
  }
  return hash.digest("hex");
}
// Move assets next to the canonical main.tex.njk, including ZIPs with an enclosing directory.
async function copyForAdoption(upload: UploadedTemplate, dir: string): Promise<string[]> {
  const parent = dirname(upload.mainFile);
  const prefix = parent === "." ? "" : `${parent}/`;
  const names = new Set<string>();
  for (const name of upload.files) {
    const target = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (names.has(target)) throw new TemplateError("invalid-entry", "Conflicting adopted asset paths");
    names.add(target);
    await mkdir(dirname(join(dir, target)), { recursive: true });
    await writeFile(join(dir, target), await readFile(join(upload.dir, name)), { flag: "wx" });
  }
  return [...names];
}
async function preview(upload: UploadedTemplate, proposal: AdoptionProposal, resume: Resume, original: string) {
  const meta = validateProposal(proposal, original);
  const dir = await mkdtemp(join(tmpdir(), "vita-template-preview-"));
  try {
    await copyForAdoption(upload, dir);
    await writeFile(join(dir, "main.tex.njk"), proposal.mainTexNjk);
    const tex = renderTex({ ...resume, template: meta.id }, { dir, meta });
    await warmUploadedPackages(tex);
    const compiled = await compileTex({ tex, assetsDir: dir });
    const renderCheck = checkRender(resume, await pdfText(compiled.pdf));
    if (!renderCheck.ok)
      throw new CompileError("Adopted template failed extraction check", JSON.stringify(renderCheck));
    return { ...compiled, renderCheck };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function proposeAdoption(
  ws: WorkspaceHandle,
  uploadId: string,
  deps: PipelineDeps,
): Promise<AdoptionProposal> {
  const release = await templateLocks.acquire(await templatePath(ws.root, incoming(uploadId)), "propose");
  try {
    deps.signal?.throwIfAborted();
    const upload = await loadUpload(ws.root, uploadId);
    const original = await scanUpload(upload);
    const hash = await uploadHash(upload);
    // Clear an earlier preview before a new attempt; a failed revision cannot be approved.
    for (const name of ["proposal.json", "preview.pdf"])
      await rm(await templatePath(ws.root, `${artifacts(uploadId)}/${name}`), { force: true });
    deps.onProgress?.({ stage: "original" });
    const compiled = await compileOriginal(upload);
    await writeFileAtomic(ws.root, `${artifacts(uploadId)}/original.pdf`, compiled.pdf);
    let resume: Resume;
    try {
      resume = Resume.parse(JSON.parse(await readText(ws.root, "resumes/master/resume.json")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      resume = Resume.parse(
        JSON.parse(await readFile(new URL("./fixtures/sample-resume.json", import.meta.url), "utf8")),
      );
    }
    const system = await buildSystemPrompt({
      role: templateAdopterRole,
      root: ws.root,
      bundledDir: ws.bundledDir,
      task: "Convert the supplied template to the Vita contract. Propose only; preserve layout code.",
    });
    let feedback = "";
    for (let round = 0; round < 2; round++) {
      deps.signal?.throwIfAborted();
      deps.onProgress?.({ stage: "adoption", round });
      const result = await runRole({
        role: templateAdopterRole,
        root: ws.root,
        system,
        task: [
          "Replace fictional sample content with header, sections and layout placeholders using nbconvert delimiters. Call submit_template with templateYaml, mainTexNjk, notes. Keep every original usepackage/newcommand line exactly. Use only for/if tags and no file includes, function calls or raw filters. Load hyperref with hidelinks and microtype (preserve existing package lines). Header contacts have label, value, href and display: render href with \\href{((( contact.href | url )))}{((( contact.display )))} when set, otherwise display, with no Label: prefix. Entry item.links contains engine-resolved {label, url} pairs: render small clickable links after item.title, using the url filter for href targets; display and label use normal automatic escaping. Explicit links: [] hides entry links.",
          wrapUntrusted(upload.mainFile, original),
          wrapUntrusted("other files", JSON.stringify(upload.files.filter((name) => name !== upload.mainFile))),
          wrapUntrusted("preview resume", JSON.stringify(resume)),
          feedback,
        ].join("\n\n"),
        tools: { root: ws.root, index: { claims: new Map(), variants: new Map() }, search: { query: () => [] } },
        runtime: deps.runtime,
        models: deps.models,
        modelOverride: deps.modelOverrides?.["template-adopter"],
        signal: deps.signal,
        retry: deps.retry,
        onUsage: deps.onUsage,
      });
      const proposal = AdoptionProposal.parse({ id: uploadId, ...result });
      try {
        deps.onProgress?.({ stage: "preview", round });
        const rendered = await preview(upload, proposal, resume, original);
        deps.signal?.throwIfAborted();
        if ((await uploadHash(upload)) !== hash)
          throw new TemplateError("stale-upload", "Upload changed during adoption");
        await writeFileAtomic(ws.root, `${artifacts(uploadId)}/preview.pdf`, rendered.pdf);
        const saved: SavedProposal = { proposal, uploadHash: hash, renderCheck: rendered.renderCheck };
        await writeTextAtomic(ws.root, `${artifacts(uploadId)}/proposal.json`, JSON.stringify(saved));
        return proposal;
      } catch (error) {
        deps.signal?.throwIfAborted();
        if (round === 1) throw error;
        const log = error instanceof CompileError ? `${error.message}\n${error.log}` : String(error);
        feedback = [
          "Correct the failed proposal once using this validation/compile log:",
          wrapUntrusted("validation log", log.slice(-20_000)),
          wrapUntrusted("failed proposal", JSON.stringify(proposal)),
        ].join("\n\n");
      }
    }
    throw new TemplateError("invalid-proposal", "No valid proposal");
  } finally {
    release();
  }
}
export async function savedProposal(root: string, id: string): Promise<SavedProposal | null> {
  try {
    await templatePath(root, `${artifacts(id)}/proposal.json`);
    return JSON.parse(await readText(root, `${artifacts(id)}/proposal.json`));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function approveTemplate(
  root: string,
  uploadId: string,
  proposal: AdoptionProposal,
): Promise<{ templateId: string; sha: string | null }> {
  const release = await templateLocks.acquire(await templatePath(root, incoming(uploadId)), "approve");
  let stage: string | undefined;
  try {
    const upload = await loadUpload(root, uploadId);
    const saved = await savedProposal(root, uploadId);
    const parsed = AdoptionProposal.parse(proposal);
    if (
      !saved ||
      parsed.id !== uploadId ||
      JSON.stringify(parsed) !== JSON.stringify(saved.proposal) ||
      (await uploadHash(upload)) !== saved.uploadHash
    )
      throw new TemplateError("stale-proposal", "Approve the current successfully previewed proposal");
    const meta = validateProposal(parsed, await scanUpload(upload));
    const target = await templatePath(root, `templates/${meta.id}`);
    const targetRelease = await templateLocks.acquire(target, "approve-target");
    try {
      try {
        await lstat(target);
        throw new TemplateError("template-exists", "Template id already exists");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      stage = await mkdtemp(join(await templatePath(root, "templates"), ".adopt-"));
      await copyForAdoption(upload, stage);
      await writeFile(join(stage, "template.yaml"), parsed.templateYaml);
      await writeFile(join(stage, "main.tex.njk"), parsed.mainTexNjk);
      await templatePath(root, `.vita/template-previews/${meta.id}.pdf`);
      await writeFileAtomic(
        root,
        `.vita/template-previews/${meta.id}.pdf`,
        await readFile(await templatePath(root, `${artifacts(uploadId)}/preview.pdf`)),
      );

      await rename(stage, target);
      stage = undefined;
      const sha = await commitPaths(root, [`templates/${meta.id}`], `Adopt template ${meta.id}`, "user");
      await rm(await templatePath(root, incoming(uploadId)), { recursive: true });
      await rm(await templatePath(root, artifacts(uploadId)), { recursive: true, force: true });
      return { templateId: meta.id, sha };
    } finally {
      targetRelease();
    }
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
    release();
  }
}
