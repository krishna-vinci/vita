import { access, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Hono } from "hono";
import { getUserById, listUsers, type User } from "../accounts/users.js";
import { ApiFailure } from "../errors.js";
import { type RuntimeOptions, WorkspaceRuntime } from "../runtime.js";
import { createWorkspaceApp } from "../server.js";

interface Entry {
  ready: Promise<{ runtime: WorkspaceRuntime; app: Hono }>;
  touched: number;
  requests: number;
}
export interface ManagerOptions {
  dataDir: string;
  bundledDir: string;
  db: DatabaseSync;
  idleMs?: number;
  createRuntime?: (options: RuntimeOptions) => Promise<WorkspaceRuntime>;
}
export class WorkspaceManager {
  readonly #entries = new Map<number, Entry>();
  readonly #timer: ReturnType<typeof setInterval>;
  readonly #idleMs: number;
  constructor(readonly options: ManagerOptions) {
    this.#idleMs = options.idleMs ?? 15 * 60 * 1000;
    this.#timer = setInterval(
      () => {
        void this.closeIdle().catch((error) => console.warn("Workspace cleanup failed", error));
      },
      Math.min(this.#idleMs, 60_000),
    );
    this.#timer.unref();
  }
  workspacePath(user: User): string {
    return path.resolve(user.workspace ?? path.join(this.options.dataDir, "users", user.username));
  }
  #accountTail: Promise<unknown> = Promise.resolve();
  async serializeAccounts<T>(action: () => Promise<T>): Promise<T> {
    const next = this.#accountTail.then(action);
    this.#accountTail = next.catch(() => {});
    return next;
  }
  async validateNewWorkspace(username: string, explicit?: string): Promise<void> {
    const root = path.resolve(explicit ?? path.join(this.options.dataDir, "users", username));
    if (!explicit) {
      try {
        await access(root);
        throw new ApiFailure(
          409,
          "workspace-exists",
          "A retained workspace exists for this username; choose another username",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const canonical = await this.#canonical(root);
    const data = await this.#canonical(path.resolve(this.options.dataDir));
    if (canonical === data || data.startsWith(`${canonical}${path.sep}`))
      throw new ApiFailure(409, "workspace-overlap", "New workspace cannot contain the accounts data directory");
    await this.#checkIsolation(root);
  }
  async #canonical(root: string): Promise<string> {
    try {
      return await realpath(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return path.join(await this.#canonical(path.dirname(root)), path.basename(root));
    }
  }
  async #checkIsolation(root: string, userId?: number): Promise<void> {
    const canonical = await this.#canonical(root);
    for (const other of listUsers(this.options.db)) {
      if (other.id === userId) continue;
      const existing = await this.#canonical(this.workspacePath(other));
      if (
        canonical === existing ||
        canonical.startsWith(`${existing}${path.sep}`) ||
        existing.startsWith(`${canonical}${path.sep}`)
      )
        throw new ApiFailure(409, "workspace-overlap", "Workspace overlaps another account's workspace");
    }
  }
  async #create(user: User) {
    let root = this.workspacePath(user);
    await this.#checkIsolation(root, user.id);
    if (!user.workspace) {
      const users = path.resolve(this.options.dataDir, "users");
      await mkdir(users, { recursive: true, mode: 0o700 });
      const realUsers = await realpath(users);
      root = path.join(realUsers, user.username);
      // Reject a pre-existing user-root symlink before runtime initialization can write through it.
      if ((await this.#canonical(root)) !== root)
        throw new ApiFailure(403, "path-forbidden", "User workspace must not be a symlink");
    }
    const runtime = await (this.options.createRuntime ?? WorkspaceRuntime.create)({
      root,
      bundledDir: this.options.bundledDir,
    });
    return { runtime, app: createWorkspaceApp(runtime) };
  }
  async for(user: User) {
    if (user.disabled) throw new ApiFailure(403, "forbidden", "Account disabled");
    let entry = this.#entries.get(user.id);
    if (!entry) {
      entry = { ready: this.#create(user), touched: Date.now(), requests: 0 };
      this.#entries.set(user.id, entry);
      const created = entry;
      void entry.ready.catch(() => {
        if (this.#entries.get(user.id) === created) this.#entries.delete(user.id);
      });
    }
    entry.touched = Date.now();
    const workspace = await entry.ready;
    const current = getUserById(this.options.db, user.id);
    if (!current || current.disabled) {
      await this.stop(user.id);
      throw new ApiFailure(403, "forbidden", "Account unavailable");
    }
    return workspace;
  }
  async fetch(user: User, request: Request): Promise<Response> {
    const ready = this.for(user);
    const entry = this.#entries.get(user.id);
    if (entry) entry.requests++;
    try {
      const workspace = await ready;
      return await workspace.app.fetch(request);
    } finally {
      if (entry) {
        entry.requests--;
        entry.touched = Date.now();
      }
    }
  }
  async closeStreams(id: number): Promise<void> {
    const entry = this.#entries.get(id);
    const workspace = await entry?.ready.catch(() => null);
    workspace?.runtime.hub.closeStreams();
  }
  async stop(id: number): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#entries.delete(id);
    const workspace = await entry.ready.catch(() => null);
    if (workspace) {
      workspace.runtime.hub.close();
      await workspace.runtime.close();
    }
  }
  async closeIdle(now = Date.now()): Promise<void> {
    for (const [id, entry] of this.#entries) {
      if (entry.requests || now - entry.touched < this.#idleMs) continue;
      const workspace = await entry.ready.catch(() => null);
      if (
        !workspace ||
        workspace.runtime.hub.subscriberCount ||
        workspace.runtime.jobs.list().some((job) => ["queued", "running"].includes(job.status))
      )
        continue;
      await this.stop(id);
    }
  }
  async close(): Promise<void> {
    clearInterval(this.#timer);
    await Promise.all([...this.#entries.keys()].map((id) => this.stop(id)));
  }
}
