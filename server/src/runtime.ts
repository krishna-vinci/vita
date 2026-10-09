import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyOps,
  assignOutlineAnchors,
  buildSystemPrompt,
  checkerRole,
  checkRender,
  commitPaths,
  compileTex,
  createGenerationRuntime,
  EvidenceSearch,
  evaluateDone,
  FileLocks,
  fileHash,
  generateBase,
  generateMaster,
  initWorkspace,
  lintResume,
  loadModelsConfig,
  loadReviewContext,
  loadTemplate,
  log,
  ModelsConfig,
  modelWarnings,
  type PipelineDeps,
  parseOutline,
  pdfText,
  RoleError,
  readText,
  relFromRoot,
  renderMarkdown,
  renderTex,
  resolveInWorkspace,
  runRole,
  tailor,
  undoPaths,
  type WorkspaceHandle,
  wrapUntrusted,
  writeFileAtomic,
  writeTextAtomic,
} from "@vita/core";
import {
  type ApplicationResource,
  type ApplicationSummary,
  JobAnalysis,
  type JobView,
  type PutSettingsRequest,
  Resume,
  type ResumeOpsRequest,
  type ResumeResource,
  type ResumeSummary,
  Review,
  type RoleUsage,
  type SettingsView,
  Slug,
  visibleBullets,
} from "@vita/shared";
import { parse as parseYaml } from "yaml";
import { ApiFailure } from "./errors.js";
import { EventHub } from "./events.js";
import { type JobContext, JobRunner } from "./jobs/runner.js";

export interface RuntimeOptions extends WorkspaceHandle {
  runtime?: PipelineDeps["runtime"];
  models?: PipelineDeps["models"];
  retry?: PipelineDeps["retry"];
}

export class WorkspaceRuntime {
  readonly hub = new EventHub();
  readonly locks = new FileLocks();
  readonly jobs: JobRunner;
  readonly ws: WorkspaceHandle;
  private readonly closeModel: () => Promise<void>;
  private constructor(
    readonly options: RuntimeOptions & { runtime: PipelineDeps["runtime"] },
    close: () => Promise<void>,
  ) {
    this.ws = { root: path.resolve(options.root), bundledDir: path.resolve(options.bundledDir) };
    this.closeModel = close;
    this.jobs = new JobRunner(this.hub, (job) =>
      writeTextAtomic(this.ws.root, `.vita/jobs/${job.id}.json`, `${JSON.stringify(job)}\n`),
    );
  }
  static async create(options: RuntimeOptions): Promise<WorkspaceRuntime> {
    try {
      await readdir(options.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await initWorkspace(options.root, { name: "My workspace" });
    }
    const created = options.runtime
      ? { runtime: options.runtime, close: async () => {} }
      : await createGenerationRuntime();
    return new WorkspaceRuntime({ ...options, runtime: created.runtime }, created.close);
  }
  async close(): Promise<void> {
    for (const job of this.jobs.list()) this.jobs.cancel(job.id);
    await this.jobs.idle();
    await this.closeModel();
  }
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const release = await this.locks.acquire(this.ws.root, "server");
    try {
      return await action();
    } finally {
      release();
    }
  }
  async optional(rel: string): Promise<string | undefined> {
    try {
      return await readText(this.ws.root, rel);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async ids(dir: string): Promise<string[]> {
    try {
      return (await readdir(resolveInWorkspace(this.ws.root, dir))).filter((id) => Slug.safeParse(id).success).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async markdown(rel: "outline.md" | "projects.md") {
    const markdown = (await this.optional(rel)) ?? "";
    return { markdown, hash: await fileHash(this.ws.root, rel) };
  }
  async checkHash(rel: string, expected: string | null): Promise<void> {
    if ((await fileHash(this.ws.root, rel)) !== expected)
      throw new ApiFailure(409, "stale-hash", "File changed. Reload before saving.");
  }
  changed(
    scope: "outline" | "projects" | "resume" | "application" | "settings",
    sha: string | null,
    id?: string,
  ): void {
    this.hub.publish({ type: "resource.changed", scope, sha, ...(id ? { id } : {}) });
  }
  async putMarkdown(rel: "outline.md" | "projects.md", markdown: string, baseHash: string | null) {
    return this.exclusive(async () => {
      await this.checkHash(rel, baseHash);
      await writeTextAtomic(this.ws.root, rel, markdown);
      const sha = await commitPaths(this.ws.root, [rel], `Update ${rel}`, "user");
      this.changed(rel === "outline.md" ? "outline" : "projects", sha);
      return { ...(await this.markdown(rel)), sha };
    });
  }
  prefix(scope: "resume" | "application", id: string): string {
    Slug.parse(id);
    return `${scope === "resume" ? "resumes" : "applications"}/${id}`;
  }
  async resource(scope: "resume" | "application", id: string): Promise<ResumeResource> {
    const prefix = this.prefix(scope, id);
    const [text, reviewText, hash] = await Promise.all([
      readText(this.ws.root, `${prefix}/resume.json`),
      this.optional(`${prefix}/review.json`),
      fileHash(this.ws.root, `${prefix}/resume.json`),
    ]);
    const pdf = `${prefix}/${scope === "application" ? "out/" : ""}resume.pdf`;
    return {
      resume: Resume.parse(JSON.parse(text)),
      review: reviewText ? Review.parse(JSON.parse(reviewText)) : null,
      hash: hash ?? "",
      pdfUrl: (await fileHash(this.ws.root, pdf)) ? `/api/files/${pdf}` : null,
    };
  }
  async application(id: string): Promise<ApplicationResource> {
    const prefix = this.prefix("application", id);
    const resource = await this.resource("application", id);
    return {
      ...resource,
      jobText: await readText(this.ws.root, `${prefix}/job.md`),
      notes: (await this.optional(`${prefix}/notes.md`)) ?? "",
      analysis: JobAnalysis.parse(JSON.parse(await readText(this.ws.root, `${prefix}/analysis.json`))),
      gaps: resource.review?.gaps ?? [],
      answers: await this.answers(prefix),
    };
  }
  private async answers(prefix: string): Promise<Record<string, string>> {
    const meta = await this.optional(`${prefix}/meta.yaml`);
    const parsed = meta === undefined ? undefined : (parseYaml(meta) as { answers?: unknown } | null);
    const answers = parsed?.answers;
    if (!answers || typeof answers !== "object") return {};
    return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, String(value)]));
  }
  async resumes(): Promise<ResumeSummary[]> {
    const results: ResumeSummary[] = [];
    for (const id of await this.ids("resumes")) {
      if ((await this.optional(`resumes/${id}/resume.json`)) === undefined) continue;
      const resource = await this.resource("resume", id);
      if (resource.resume.kind === "job") continue;
      results.push({
        id,
        name:
          id === "master"
            ? "Master resume"
            : ((await loadReviewContext(this.ws, resource.resume)).baseConfig?.name ?? id),
        kind: resource.resume.kind,
        done: resource.review?.done ?? false,
        pdfUrl: resource.pdfUrl,
      });
    }
    return results;
  }
  async applications(): Promise<ApplicationSummary[]> {
    const results: ApplicationSummary[] = [];
    for (const id of await this.ids("applications")) {
      if ((await this.optional(`applications/${id}/resume.json`)) === undefined) continue;
      const resource = await this.application(id);
      results.push({
        id,
        title: resource.analysis.title,
        company: resource.analysis.company,
        baseId: resource.resume.parent,
        done: resource.review?.done ?? false,
        pdfUrl: resource.pdfUrl,
      });
    }
    return results.reverse();
  }
  async settings(): Promise<SettingsView> {
    const models = this.options.models ?? (await loadModelsConfig(this.ws.root));
    const saved = await this.optional("config/server.json");
    const template = saved ? Slug.parse(JSON.parse(saved).template) : "rover-base";
    const providers = new Set([
      ...this.options.runtime.getModels().map((model) => model.provider),
      models.default.split("/")[0] ?? "",
      ...Object.values(models.roles).map((value) => value.split("/")[0] ?? ""),
    ]);
    return {
      models,
      template,
      providers: [...providers]
        .sort()
        .map((id) => ({ id, hasCredentials: this.options.runtime.hasConfiguredAuth(id) })),
      warnings: modelWarnings(models),
    };
  }
  async putSettings(input: PutSettingsRequest) {
    return this.exclusive(async () => {
      await this.template(input.template);
      const models = ModelsConfig.parse(input.models);
      await writeTextAtomic(this.ws.root, "config/models.yaml", `${JSON.stringify(models, null, 2)}\n`);
      await writeTextAtomic(this.ws.root, "config/server.json", `${JSON.stringify({ template: input.template })}\n`);
      // Injected faux configurations also follow settings changes.
      if (this.options.models) this.options.models = models;
      const sha = await commitPaths(
        this.ws.root,
        ["config/models.yaml", "config/server.json"],
        "Update settings",
        "user",
      );
      this.changed("settings", sha);
      return { ...(await this.settings()), sha };
    });
  }
  async template(id: string) {
    return loadTemplate(
      [resolveInWorkspace(this.ws.root, "templates"), path.join(this.ws.bundledDir, "templates")],
      id,
    );
  }
  async ops(scope: "resume" | "application", id: string, input: ResumeOpsRequest) {
    return this.exclusive(async () => {
      if (this.jobs.hasActive(scope, id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
      const prefix = this.prefix(scope, id);
      if (input.baseHash !== undefined) await this.checkHash(`${prefix}/resume.json`, input.baseHash);
      const resource = await this.resource(scope, id);
      const { index, rules, pack } = await loadReviewContext(this.ws, resource.resume);
      const template = await this.template(resource.resume.template);
      const result = applyOps(resource.resume, input.ops, {
        by: "user",
        index,
        template: template.meta,
        now: () => new Date().toISOString(),
      });
      const changed = new Set(result.changedBullets);
      const lint = lintResume(result.resume, { index, rules, pack });
      const previous =
        resource.review ??
        Review.parse({
          round: 0,
          lint: [],
          checks: [],
          ats: [],
          render: null,
          gaps: [],
          overrides: [],
          done: false,
          blocking: [],
        });
      const review = {
        ...previous,
        done: false,
        render: null,
        checks: previous.checks.filter((note) => !changed.has(note.bulletId)),
        lint: resource.review
          ? [
              ...previous.lint.filter((note) => !note.bulletId || !changed.has(note.bulletId)),
              ...lint.filter((note) => note.bulletId && changed.has(note.bulletId)),
            ]
          : lint,
        blocking: ["Resume changed; checking and rendering required."],
      };
      const usage: RoleUsage[] = [];
      const toCheck = new Set(
        visibleBullets(result.resume)
          .filter((bullet) => changed.has(bullet.id) && !bullet.override)
          .map((bullet) => bullet.id),
      );
      if (toCheck.size) {
        const selected = structuredClone(result.resume);
        for (const section of selected.sections)
          for (const item of section.items) item.bullets = item.bullets.filter((bullet) => toCheck.has(bullet.id));
        const outline = parseOutline(assignOutlineAnchors(await readText(this.ws.root, "outline.md")).markdown);
        const search = EvidenceSearch.build(index, outline);
        try {
          const models = this.options.models ?? (await loadModelsConfig(this.ws.root));
          const checked = await runRole({
            role: checkerRole,
            root: this.ws.root,
            system: await buildSystemPrompt({
              role: checkerRole,
              root: this.ws.root,
              bundledDir: this.ws.bundledDir,
              applicationId: scope === "application" ? id : undefined,
              task: "Check changed bullets independently, including locked user bullets.",
            }),
            task: [
              "Check each supplied visible bullet against its claims and evidence. Return submit_checks. These are the changed bullets only.",
              wrapUntrusted("changed resume", JSON.stringify(selected)),
              wrapUntrusted("claims", JSON.stringify([...index.claims.values()])),
            ].join("\n\n"),
            tools: { root: this.ws.root, index, search, resume: selected },
            runtime: this.options.runtime,
            models,
            retry: this.options.retry,
            onUsage: (entry) => usage.push(entry),
          });
          review.checks.push(...checked.checks.filter((note) => toCheck.has(note.bulletId)));
        } catch (error) {
          review.blocking.push(
            error instanceof RoleError
              ? `${error.role} model ${error.model} failed: ${error.message}`
              : `Checker failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          search.close();
        }
      }
      // External edits during a model call must not be overwritten.
      await this.checkHash(`${prefix}/resume.json`, resource.hash);
      if (usage.length)
        await writeTextAtomic(
          this.ws.root,
          `.vita/edits/${randomUUID()}.json`,
          `${JSON.stringify({ scope, id, usage })}\n`,
        );
      await writeTextAtomic(this.ws.root, `${prefix}/resume.json`, `${JSON.stringify(result.resume, null, 2)}\n`);
      const paths = [`${prefix}/resume.json`];
      if (review) {
        await writeTextAtomic(this.ws.root, `${prefix}/review.json`, `${JSON.stringify(review, null, 2)}\n`);
        paths.push(`${prefix}/review.json`);
      }
      const sha = await commitPaths(this.ws.root, paths, "Apply resume edits", "user");
      this.changed(scope, sha, id);
      return { ...(await this.resource(scope, id)), sha, changedBullets: result.changedBullets, usage };
    });
  }
  async pipelineDeps(ctx: JobContext): Promise<PipelineDeps> {
    return {
      runtime: this.options.runtime,
      models: this.options.models ?? (await loadModelsConfig(this.ws.root)),
      retry: this.options.retry,
      signal: ctx.signal,
      onProgress: ctx.progress,
      onUsage: ctx.addUsage,
    };
  }
  enqueue(
    kind: JobView["kind"],
    id: string | null,
    input: {
      name?: string;
      packs?: string[];
      jobText?: string;
      baseId?: string;
      notes?: string;
      answers?: Record<string, string>;
    },
  ) {
    return this.jobs.enqueue(kind, id, (ctx) =>
      this.exclusive(async () => {
        const deps = await this.pipelineDeps(ctx);
        let resultId: string;
        const scope = kind === "master" || kind === "base" ? "resume" : "application";
        if (kind === "master") {
          await generateMaster(this.ws, deps);
          resultId = "master";
        } else if (kind === "base") {
          const result = await generateBase(
            this.ws,
            { name: input.name ?? "", packs: input.packs, template: (await this.settings()).template },
            deps,
          );
          resultId = result.id;
        } else {
          const existing = kind === "answers" && id ? await this.application(id) : undefined;
          const result = await tailor(
            this.ws,
            {
              jobText: existing?.jobText ?? input.jobText ?? "",
              baseId: existing?.resume.parent ?? input.baseId,
              applicationId: existing ? (id ?? undefined) : undefined,
              slug: existing ? undefined : `job-${ctx.signal.aborted ? "cancelled" : randomUUID().slice(0, 12)}`,
              answers: input.answers,
              notes: existing?.notes ?? input.notes,
              template: (await this.settings()).template,
            },
            deps,
          );
          resultId = result.resume.id;
        }
        return { scope, id: resultId, sha: (await log(this.ws.root, 1))[0]?.sha ?? null };
      }),
    );
  }
  async exportApplication(id: string) {
    return this.exclusive(async () => {
      if (this.jobs.hasActive("application", id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
      const resource = await this.application(id);
      if (!resource.review) throw new ApiFailure(409, "review-required", "A checked resume is required before export");
      const { index, rules, pack, maxPages } = await loadReviewContext(this.ws, resource.resume);
      const lint = lintResume(resource.resume, { index, rules, pack });
      const overrides = resource.resume.sections.flatMap((section) =>
        section.items.flatMap((item) =>
          item.bullets.flatMap((bullet) =>
            bullet.override
              ? [
                  {
                    bulletId: bullet.id,
                    reason: bullet.override.note ?? bullet.override.reason,
                    at: bullet.override.at,
                  },
                ]
              : [],
          ),
        ),
      );
      if (!resource.review.done) {
        const overridden = new Set(overrides.map((entry) => entry.bulletId));
        const allowed = new Set<string>(["Resume changed; checking and rendering required."]);
        for (const finding of resource.review.lint)
          if (finding.severity === "block" && finding.bulletId && overridden.has(finding.bulletId))
            allowed.add(`${finding.rule}: ${finding.message}`);
        for (const note of resource.review.checks)
          if (overridden.has(note.bulletId)) allowed.add(`${note.verdict}: ${note.bulletId}: ${note.reason}`);
        for (const bulletId of overridden) allowed.add(`Unchecked bullet: ${bulletId}`);
        if (!resource.review.blocking.length || resource.review.blocking.some((reason) => !allowed.has(reason)))
          throw new ApiFailure(409, "review-blocked", resource.review.blocking.join("; ") || "Review is incomplete");
      }
      const certification = {
        resume: resource.resume,
        lint,
        checks: resource.review.checks,
        analysis: resource.analysis,
        gaps: resource.gaps,
        overrides,
      };
      const preliminary = evaluateDone({
        ...certification,
        render: { pages: 1, maxPages, ok: true, missingBullets: [], outOfOrder: [] },
      });
      if (!preliminary.done) throw new ApiFailure(409, "review-blocked", preliminary.blocking.join("; "));
      const template = await this.template(resource.resume.template);
      const tex = renderTex(resource.resume, template);
      const compiled = await compileTex({ tex, assetsDir: template.dir });
      const render = checkRender(resource.resume, await pdfText(compiled.pdf), maxPages);
      const done = evaluateDone({ ...certification, render });
      if (!done.done) throw new ApiFailure(409, "review-blocked", done.blocking.join("; "));
      const prefix = this.prefix("application", id);
      const review = Review.parse({ ...resource.review, lint, render, overrides, ...done });
      // Do not replace the last good PDF until compile and extraction both pass.
      await writeFileAtomic(this.ws.root, `${prefix}/out/resume.pdf`, compiled.pdf);
      await writeTextAtomic(this.ws.root, `${prefix}/out/resume.tex`, tex);
      await writeTextAtomic(this.ws.root, `${prefix}/out/resume.md`, renderMarkdown(resource.resume));
      await writeTextAtomic(this.ws.root, `${prefix}/review.json`, `${JSON.stringify(review, null, 2)}\n`);
      const sha = await commitPaths(
        this.ws.root,
        [`${prefix}/out`, `${prefix}/review.json`],
        "Export application resume",
        "user",
      );
      this.changed("application", sha, id);
      return { resource: await this.application(id), sha, pdfUrl: `/api/files/${prefix}/out/resume.pdf` };
    });
  }
  async undo(scope: "resume" | "application" | "outline" | "projects", id?: string) {
    return this.exclusive(async () => {
      if (this.jobs.hasActive())
        throw new ApiFailure(409, "workspace-busy", "Wait for generation before undoing a change");
      const paths = scope === "outline" || scope === "projects" ? [`${scope}.md`] : [this.prefix(scope, id ?? "")];
      // A resume or job can be undone back to its generated first version, never past it.
      const sha = await undoPaths(
        this.ws.root,
        paths,
        "user",
        scope === "resume" || scope === "application" ? ["writer", "system", "importer"] : [],
      );
      this.changed(scope, sha, id);
      let resource: ResumeResource | ApplicationResource | Awaited<ReturnType<WorkspaceRuntime["markdown"]>> | null;
      if (scope === "outline" || scope === "projects") resource = await this.markdown(`${scope}.md`);
      else if ((await this.optional(`${paths[0]}/resume.json`)) === undefined) resource = null;
      else resource = scope === "resume" ? await this.resource(scope, id ?? "") : await this.application(id ?? "");
      return { resource, sha };
    });
  }
  async pdf(rel: string): Promise<Buffer> {
    const allowed = /^(?:resumes\/[a-z0-9][a-z0-9-]*\/[^/]+\.pdf|applications\/[a-z0-9][a-z0-9-]*\/out\/[^/]+\.pdf)$/;
    if (!allowed.test(rel)) throw new ApiFailure(403, "file-forbidden", "Only resume PDFs may be served");
    const absolute = resolveInWorkspace(this.ws.root, rel);
    if (!allowed.test(relFromRoot(this.ws.root, absolute)))
      throw new ApiFailure(403, "file-forbidden", "PDF path leaves an allowed output directory");
    return readFile(absolute);
  }
}
