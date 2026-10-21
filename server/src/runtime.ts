import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  applyOps,
  assignOutlineAnchors,
  buildSystemPrompt,
  checkerContext,
  checkerRole,
  checkPatchedRender,
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
  linkedResume,
  lintResume,
  loadModelsConfig,
  loadRenderSources,
  loadReviewContext,
  loadTemplate,
  log,
  ModelsConfig,
  modelWarnings,
  type PipelineDeps,
  parseOutline,
  pdfText,
  type ResearchDeps,
  RoleError,
  readText,
  recordExportedVersion,
  relFromRoot,
  renderMarkdown,
  renderStoredTex,
  resolveInWorkspace,
  resolveRoleModel,
  runRole,
  tailor,
  undoPaths,
  VerdictCache,
  type WebFetch,
  type WorkspaceHandle,
  wrapUntrusted,
  writeFileAtomic,
  writeTextAtomic,
} from "@vita/core";
import {
  type ApplicationResource,
  type ApplicationSummary,
  type ArchivedFilter,
  type AvailableModelsView,
  JobAnalysis,
  JobView,
  type PutSettingsRequest,
  providerSetupHints,
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
import { parse as parseYaml, stringify } from "yaml";
import { ChatThreads } from "./chat-threads.js";
import { ApiFailure } from "./errors.js";
import { EventHub } from "./events.js";
import { type JobContext, JobRunner } from "./jobs/runner.js";

export interface RuntimeOptions extends WorkspaceHandle {
  runtime?: PipelineDeps["runtime"];
  models?: PipelineDeps["models"];
  retry?: PipelineDeps["retry"];
  githubToken?: () => string | undefined;
  researchFetch?: WebFetch;
}

export class WorkspaceRuntime {
  private readonly verdictCache = new VerdictCache();
  readonly hub = new EventHub();
  readonly locks = new FileLocks();
  readonly jobs: JobRunner;
  readonly ws: WorkspaceHandle;
  readonly chats: ChatThreads;
  private readonly closeModel: () => Promise<void>;
  private constructor(
    readonly options: RuntimeOptions & { runtime: PipelineDeps["runtime"] },
    close: () => Promise<void>,
  ) {
    this.ws = { root: path.resolve(options.root), bundledDir: path.resolve(options.bundledDir) };
    this.chats = new ChatThreads(this.ws.root);
    this.closeModel = close;
    this.jobs = new JobRunner(this.hub, (job) =>
      writeTextAtomic(this.ws.root, `.vita/jobs/${job.id}.json`, `${JSON.stringify(job)}\n`),
    );
  }
  static async create(options: RuntimeOptions): Promise<WorkspaceRuntime> {
    try {
      if ((await readdir(options.root)).length === 0) await initWorkspace(options.root, { name: "" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await initWorkspace(options.root, { name: "" });
    }
    const created = options.runtime
      ? { runtime: options.runtime, close: async () => {} }
      : await createGenerationRuntime();
    const runtime = new WorkspaceRuntime({ ...options, runtime: created.runtime }, created.close);
    try {
      const history: JobView[] = [];
      for (const file of (await readdir(resolveInWorkspace(runtime.ws.root, ".vita/jobs"))).filter((file) =>
        file.endsWith(".json"),
      )) {
        const parsed = JobView.safeParse(JSON.parse(await readText(runtime.ws.root, `.vita/jobs/${file}`)));
        if (parsed.success) history.push(parsed.data);
      }
      runtime.jobs.seedHistory(history.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await runtime.close();
        throw error;
      }
    }
    return runtime;
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
      this.optional(`${prefix}/resume.json`),
      this.optional(`${prefix}/review.json`),
      fileHash(this.ws.root, `${prefix}/resume.json`),
    ]);
    if (text === undefined) {
      if (scope === "application" && (await this.optional(`${prefix}/analysis.json`)) !== undefined)
        throw new ApiFailure(
          409,
          "resume-required",
          "Answer the application questions or skip and write now before editing a resume",
        );
      throw new ApiFailure(404, "not-found", "Resume not found");
    }
    const pdf = `${prefix}/${scope === "application" ? "out/" : ""}resume.pdf`;
    const metadata = await this.metadata(scope, id);
    const resume = Resume.parse(JSON.parse(text));
    // The same links the PDF shows, for the editor; never written back into the resume.
    const links = Object.fromEntries(
      linkedResume(resume, await loadRenderSources(this.ws.root)).sections.flatMap((section) =>
        section.items.map((item) => [item.id, item.links ?? []] as const),
      ),
    );
    return {
      archived: typeof metadata.archived === "string" ? metadata.archived : undefined,
      instructions: String((scope === "application" ? metadata.notes : metadata.instructions) ?? ""),
      resume,
      patchConflict: (await this.optional(`${prefix}/tex.conflict.json`)) !== undefined,
      links,
      review: reviewText ? Review.parse(JSON.parse(reviewText)) : null,
      hash: hash ?? "",
      pdfUrl: (await fileHash(this.ws.root, pdf)) ? `/api/files/${pdf}` : null,
    };
  }
  async application(id: string): Promise<ApplicationResource> {
    const prefix = this.prefix("application", id);
    const metadata = await this.metadata("application", id);
    const pending = (await this.optional(`${prefix}/resume.json`)) === undefined;
    const reviewText = pending ? await this.optional(`${prefix}/review.json`) : undefined;
    const resource = pending
      ? {
          resume: null,
          review: reviewText ? Review.parse(JSON.parse(reviewText)) : null,
          pdfUrl: null,
          hash: "",
          archived: typeof metadata.archived === "string" ? metadata.archived : undefined,
          instructions: String(metadata.notes ?? ""),
        }
      : await this.resource("application", id);
    return {
      ...resource,
      status: pending ? "needs-answers" : resource.review?.done ? "done" : "draft",
      jobText: await readText(this.ws.root, `${prefix}/job.md`),
      notes: resource.instructions ?? "",
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
  async resumes(archived?: ArchivedFilter): Promise<ResumeSummary[]> {
    const results: ResumeSummary[] = [];
    for (const id of await this.ids("resumes")) {
      if ((await this.optional(`resumes/${id}/resume.json`)) === undefined) continue;
      const resource = await this.resource("resume", id);
      if (resource.resume.kind === "job") continue;
      if (archived === "only" ? !resource.archived : archived !== "include" && resource.archived) continue;
      results.push({
        archived: resource.archived,
        instructions: resource.instructions,
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
  async applications(archived?: ArchivedFilter): Promise<ApplicationSummary[]> {
    const results: ApplicationSummary[] = [];
    for (const id of await this.ids("applications")) {
      if ((await this.optional(`applications/${id}/analysis.json`)) === undefined) continue;
      const resource = await this.application(id);
      if (archived === "only" ? !resource.archived : archived !== "include" && resource.archived) continue;
      results.push({
        archived: resource.archived,
        instructions: resource.instructions,
        id,
        status: resource.status,
        title: resource.analysis.title,
        company: resource.analysis.company,
        baseId: String((await this.metadata("application", id)).baseId ?? resource.resume?.parent ?? "") || null,
        done: resource.review?.done ?? false,
        pdfUrl: resource.pdfUrl,
      });
    }
    return results.reverse();
  }
  async metadata(scope: "resume" | "application", id: string): Promise<Record<string, unknown>> {
    const text = await this.optional(`${this.prefix(scope, id)}/meta.yaml`);
    return text ? (parseYaml(text) ?? {}) : {};
  }
  assertAvailable(scope: "resume" | "application", id: string) {
    if (this.jobs.hasActive(scope, id))
      throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
  }
  private async mutableResource(scope: "resume" | "application", id: string) {
    if (scope === "resume" && id === "master")
      throw new ApiFailure(
        409,
        "master-protected",
        "The master cannot be archived, deleted or given base instructions",
      );
    this.assertAvailable(scope, id);
    const resource = scope === "application" ? await this.application(id) : await this.resource(scope, id);
    if (scope === "resume" && resource.resume?.kind !== "base")
      throw new ApiFailure(409, "master-protected", "Only base resumes support this action");
    return resource;
  }
  private async saveMetadata(
    scope: "resume" | "application",
    id: string,
    metadata: Record<string, unknown>,
    message: string,
  ) {
    const rel = `${this.prefix(scope, id)}/meta.yaml`;
    await writeTextAtomic(this.ws.root, rel, stringify(metadata));
    const sha = await commitPaths(this.ws.root, [rel], message, "user");
    this.changed(scope, sha, id);
    return {
      archived: typeof metadata.archived === "string" ? metadata.archived : undefined,
      instructions: String((scope === "application" ? metadata.notes : metadata.instructions) ?? ""),
      sha,
    };
  }
  async archive(scope: "resume" | "application", id: string, archived: boolean) {
    this.assertAvailable(scope, id);
    return this.exclusive(async () => {
      await this.mutableResource(scope, id);
      const meta = await this.metadata(scope, id);
      if (archived) meta.archived ??= new Date().toISOString();
      else delete meta.archived;
      return this.saveMetadata(scope, id, meta, `${archived ? "Archive" : "Unarchive"} ${scope}: ${id}`);
    });
  }
  async putInstructions(scope: "resume" | "application", id: string, instructions: string) {
    this.assertAvailable(scope, id);
    return this.exclusive(async () => {
      await this.mutableResource(scope, id);
      const meta = await this.metadata(scope, id);
      meta[scope === "application" ? "notes" : "instructions"] = instructions;
      return this.saveMetadata(scope, id, meta, `Update ${scope} instructions: ${id}`);
    });
  }
  async regenerate(scope: "resume" | "application", id: string, instructions?: string) {
    this.assertAvailable(scope, id);
    return this.exclusive(async () => {
      await this.mutableResource(scope, id);
      let sha: string | null = null;
      if (instructions !== undefined) {
        const meta = await this.metadata(scope, id);
        meta[scope === "application" ? "notes" : "instructions"] = instructions;
        sha = (await this.saveMetadata(scope, id, meta, `Update ${scope} instructions: ${id}`)).sha;
      }
      return {
        job: this.enqueue(scope === "resume" ? "base" : "answers", id, scope === "resume" ? { baseId: id } : {}),
        sha,
      };
    });
  }
  async deleteResource(scope: "resume" | "application", id: string) {
    this.assertAvailable(scope, id);
    return this.exclusive(async () => {
      await this.mutableResource(scope, id);
      const meta = await this.metadata(scope, id);
      if (!meta.archived)
        throw new ApiFailure(409, "archive-first", "Archive this resource before permanently deleting it");
      if (scope === "resume") {
        const references: { id: string; title: string }[] = [];
        for (const appId of await this.ids("applications")) {
          const metadata = await this.metadata("application", appId);
          const text = await this.optional(`${this.prefix("application", appId)}/resume.json`);
          const resume = text ? Resume.parse(JSON.parse(text)) : undefined;
          if (metadata.baseId === id || resume?.parent === id) {
            const analysis = await this.optional(`${this.prefix("application", appId)}/analysis.json`);
            references.push({ id: appId, title: analysis ? JobAnalysis.parse(JSON.parse(analysis)).title : appId });
          }
        }
        if (references.length)
          throw new ApiFailure(409, "base-in-use", "Applications still use this base", { applications: references });
      }
      const prefix = this.prefix(scope, id);
      // Refuse symlinks throughout the resource before recursively removing its files.
      const validate = async (rel: string): Promise<void> => {
        const absolute = resolveInWorkspace(this.ws.root, rel);
        const stat = await lstat(path.join(this.ws.root, rel));
        if (relFromRoot(this.ws.root, absolute) !== rel)
          throw new ApiFailure(403, "path-forbidden", "Cannot delete a redirected resource");
        if (stat.isSymbolicLink()) throw new ApiFailure(403, "path-forbidden", "Cannot delete a symlink resource");
        if (stat.isDirectory()) for (const name of await readdir(absolute)) await validate(`${rel}/${name}`);
      };
      await validate(prefix);
      await this.chats.deleteKey(scope, id);
      if (scope === "application") await this.chats.deleteKey("letter", id);
      await rm(resolveInWorkspace(this.ws.root, prefix), { recursive: true });
      const sha = await commitPaths(this.ws.root, [prefix], `Permanently delete ${scope}: ${id}`, "user");
      this.changed(scope, sha, id);
      return { deleted: true as const, sha };
    });
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
  async availableModels(): Promise<AvailableModelsView> {
    const runtime = this.options.runtime;
    await runtime.refresh({ allowNetwork: false, signal: AbortSignal.timeout(10_000) });
    const available = await runtime.getAvailable(undefined, { signal: AbortSignal.timeout(10_000) });
    return {
      models: available
        .map((model) => ({ id: `${model.provider}/${model.id}`, provider: model.provider, name: model.name }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      setupHints: available.length ? [] : [...providerSetupHints],
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
      const lint = lintResume(result.resume, { index, rules, pack, voice: "warn" });
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
      const models = this.options.models ?? (await loadModelsConfig(this.ws.root));
      this.verdictCache.useModel(resolveRoleModel(models, "checker"));
      const cached = this.verdictCache
        .partition(result.resume, index)
        .cached.filter((note) => toCheck.has(note.bulletId));
      review.checks.push(...cached);
      for (const note of cached) toCheck.delete(note.bulletId);
      if (toCheck.size) {
        const selected = structuredClone(result.resume);
        for (const section of selected.sections)
          for (const item of section.items) item.bullets = item.bullets.filter((bullet) => toCheck.has(bullet.id));
        const outline = parseOutline(assignOutlineAnchors(await readText(this.ws.root, "outline.md")).markdown);
        const search = EvidenceSearch.build(index, outline);
        try {
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
              wrapUntrusted(
                "visible bullets and complete cited evidence",
                JSON.stringify(checkerContext(selected, index)),
              ),
            ].join("\n\n"),
            tools: { root: this.ws.root, index, search, resume: selected },
            runtime: this.options.runtime,
            models,
            retry: this.options.retry,
            onUsage: (entry) => usage.push(entry),
          });
          const actual = usage.at(-1)?.model ?? resolveRoleModel(models, "checker");
          this.verdictCache.useModel(actual);
          this.verdictCache.remember(selected, index, checked.checks);
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
      verdictCache: this.verdictCache,
      models: this.options.models ?? (await loadModelsConfig(this.ws.root)),
      retry: this.options.retry,
      signal: ctx.signal,
      onProgress: ctx.progress,
      onUsage: ctx.addUsage,
    };
  }
  async researchDeps(ctx: JobContext): Promise<ResearchDeps> {
    return {
      ...(await this.pipelineDeps(ctx)),
      githubToken: this.options.githubToken?.() ?? process.env.GITHUB_TOKEN,
      fetch: this.options.researchFetch,
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
      instructions?: string;
      answers?: Record<string, string>;
      skip?: boolean;
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
            {
              name: input.name,
              packs: input.packs,
              template: (await this.settings()).template,
              instructions: input.instructions,
              baseId: input.baseId,
            },
            deps,
          );
          resultId = result.id;
        } else {
          const existing = kind === "answers" && id ? await this.application(id) : undefined;
          // A job still waiting for answers has no resume yet; its chosen base lives in meta.yaml.
          const savedBase = existing && id ? (await this.metadata("application", id)).baseId : undefined;
          const result = await tailor(
            this.ws,
            {
              jobText: existing?.jobText ?? input.jobText ?? "",
              baseId:
                existing?.resume?.parent ?? (typeof savedBase === "string" ? savedBase : undefined) ?? input.baseId,
              applicationId: existing ? (id ?? undefined) : undefined,
              slug: existing ? undefined : `job-${ctx.signal.aborted ? "cancelled" : randomUUID().slice(0, 12)}`,
              answers: input.answers,
              skip: input.skip,
              notes: existing?.instructions ?? input.instructions ?? input.notes,
              template: (await this.settings()).template,
            },
            deps,
          );
          resultId = path.basename(result.applicationDir);
        }
        return { scope, id: resultId, sha: (await log(this.ws.root, 1))[0]?.sha ?? null };
      }),
    );
  }
  async exportApplication(id: string) {
    return this.exportResource("application", id);
  }
  /** Re-render a checked resume (job, base or master) to PDF, e.g. after style or wording edits. */
  async exportResource(scope: "resume" | "application", id: string) {
    return this.exclusive(async () => {
      if (this.jobs.hasActive(scope, id))
        throw new ApiFailure(409, "resource-busy", "Generation is still running for this resource");
      const resource =
        scope === "application"
          ? await this.application(id)
          : {
              ...(await this.resource("resume", id)),
              analysis: JobAnalysis.parse({ title: id, requirements: [], baseScores: [] }),
              gaps: [] as string[],
            };
      if (!resource.resume || !resource.review)
        throw new ApiFailure(409, "review-required", "A checked resume is required before export");
      const { index, rules, pack, maxPages } = await loadReviewContext(this.ws, resource.resume);
      const lint = lintResume(resource.resume, { index, rules, pack, voice: "warn" });
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
      const sources = await loadRenderSources(this.ws.root);
      const patched = await renderStoredTex(this.ws.root, resource.resume, template, sources);
      const generated = patched.generated;
      const tex = patched.patched;
      const compiled = await compileTex({ tex, assetsDir: template.dir });
      const render = checkPatchedRender(resource.resume, await pdfText(compiled.pdf), maxPages, generated, tex);
      if (patched.conflict) render.patchConflict = true;
      const done = evaluateDone({ ...certification, render });
      if (!done.done) throw new ApiFailure(409, "review-blocked", done.blocking.join("; "));
      const prefix = this.prefix(scope, id);
      // Job resumes keep their output under out/; base and master resumes keep it beside resume.json.
      const out = scope === "application" ? `${prefix}/out` : prefix;
      const review = Review.parse({ ...resource.review, lint, render, overrides, ...done });
      // Do not replace the last good PDF until compile and extraction both pass.
      await writeFileAtomic(this.ws.root, `${out}/resume.pdf`, compiled.pdf);
      await writeTextAtomic(this.ws.root, `${out}/resume.tex`, tex);
      await writeTextAtomic(this.ws.root, `${out}/resume.md`, renderMarkdown(resource.resume, sources));
      await writeTextAtomic(this.ws.root, `${prefix}/review.json`, `${JSON.stringify(review, null, 2)}\n`);
      const sha = await commitPaths(
        this.ws.root,
        scope === "application"
          ? [out, `${prefix}/review.json`]
          : [`${out}/resume.pdf`, `${out}/resume.tex`, `${out}/resume.md`, `${prefix}/review.json`],
        scope === "application" ? "Export application resume" : `Export resume: ${id}`,
        "user",
      );
      if (scope === "application") await recordExportedVersion(this.ws, id);
      this.changed(scope, sha, id);
      return {
        resource: scope === "application" ? await this.application(id) : await this.resource("resume", id),
        sha,
        pdfUrl: `/api/files/${out}/resume.pdf`,
      };
    });
  }
  async undo(scope: "resume" | "application" | "outline" | "projects", id?: string) {
    return this.exclusive(async () => {
      if (this.jobs.hasActive())
        throw new ApiFailure(409, "workspace-busy", "Wait for generation before undoing a change");
      if (scope === "resume" || scope === "application") await this.resource(scope, id ?? "");
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
