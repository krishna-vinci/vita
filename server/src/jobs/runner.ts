import { randomUUID } from "node:crypto";
import { RoleError } from "@vita/core";
import type { JobView, RoleUsage } from "@vita/shared";
import type { EventHub } from "../events.js";

export interface JobContext {
  signal: AbortSignal;
  progress(event: { stage: string; round?: number; message?: string }): void;
  addUsage(usage: RoleUsage): void;
}
export type JobHandler = (ctx: JobContext) => Promise<NonNullable<JobView["result"]>>;
interface Record {
  view: JobView;
  handler: JobHandler;
  controller: AbortController;
}

export class JobRunner {
  readonly #jobs = new Map<string, Record>();
  readonly #queue: Record[] = [];
  #running = false;
  readonly #idle = new Set<() => void>();
  constructor(
    private readonly hub: EventHub,
    private readonly save: (job: JobView) => Promise<void>,
  ) {}

  enqueue(kind: JobView["kind"], resourceId: string | null, handler: JobHandler): JobView {
    const record: Record = {
      view: {
        id: randomUUID(),
        kind,
        resourceId,
        status: "queued",
        progress: "",
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        usage: [],
      },
      handler,
      controller: new AbortController(),
    };
    this.#jobs.set(record.view.id, record);
    this.#queue.push(record);
    this.publish("job.queued", record);
    queueMicrotask(() => this.pump());
    return structuredClone(record.view);
  }
  list(): JobView[] {
    return [...this.#jobs.values()].map((record) => structuredClone(record.view));
  }
  get(id: string): JobView | undefined {
    const view = this.#jobs.get(id)?.view;
    return view && structuredClone(view);
  }
  hasActive(scope?: "resume" | "application", id?: string): boolean {
    return [...this.#jobs.values()].some(
      ({ view }) =>
        ["queued", "running"].includes(view.status) &&
        (!scope ||
          (scope === "application"
            ? ["tailor", "answers", "prep"].includes(view.kind)
            : ["master", "base"].includes(view.kind))) &&
        (!id || view.resourceId === id || view.resourceId === null),
    );
  }
  cancel(id: string): JobView | undefined {
    const record = this.#jobs.get(id);
    if (!record) return undefined;
    if (["queued", "running"].includes(record.view.status)) {
      record.controller.abort();
      if (record.view.status === "queued") {
        record.view.status = "cancelled";
        record.view.finishedAt = new Date().toISOString();
        this.publish("job.failed", record);
        void this.save(record.view).catch(() => {});
      }
    }
    return structuredClone(record.view);
  }
  async idle(): Promise<void> {
    if (!this.#running && !this.#queue.length) return;
    await new Promise<void>((resolve) => this.#idle.add(resolve));
  }
  private publish(type: "job.queued" | "job.progress" | "job.done" | "job.failed", record: Record): void {
    this.hub.publish({ type, job: structuredClone(record.view) });
  }
  private pump(): void {
    if (this.#running) return;
    const next = this.#queue.shift();
    if (!next) {
      for (const resolve of this.#idle) resolve();
      this.#idle.clear();
      return;
    }
    if (next.view.status !== "queued") {
      this.pump();
      return;
    }
    this.#running = true;
    void this.run(next);
  }
  private async run(record: Record): Promise<void> {
    const { view, controller } = record;
    view.status = "running";
    view.startedAt = new Date().toISOString();
    this.publish("job.progress", record);
    try {
      view.result = await record.handler({
        signal: controller.signal,
        progress: (event) => {
          view.progress = [event.stage, event.round && `round ${event.round}`, event.message]
            .filter(Boolean)
            .join(": ");
          this.publish("job.progress", record);
        },
        addUsage: (entry) => {
          view.usage.push({ ...entry });
        },
      });
      controller.signal.throwIfAborted();
      view.resourceId = view.result.id;
      view.status = "done";
      this.hub.publish({ type: "resource.changed", ...view.result });
    } catch (error) {
      view.status = controller.signal.aborted ? "cancelled" : "failed";
      view.error =
        error instanceof RoleError
          ? `${error.role} model ${error.model} failed: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);
    }
    view.finishedAt = new Date().toISOString();
    try {
      await this.save(structuredClone(view));
    } catch (error) {
      view.status = "failed";
      view.error = `Job history save failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.publish(view.status === "done" ? "job.done" : "job.failed", record);
    const finished = [...this.#jobs.values()].filter((record) => !["queued", "running"].includes(record.view.status));
    for (const old of finished.slice(0, Math.max(0, finished.length - 200))) this.#jobs.delete(old.view.id);
    this.#running = false;
    this.pump();
  }
}
