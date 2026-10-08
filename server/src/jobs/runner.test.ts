import type { VitaEvent } from "@vita/shared";
import { describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { JobRunner } from "./runner.js";

describe("job queue", () => {
  it("runs one handler at a time, records usage, publishes progress, and survives role failures", async () => {
    const hub = new EventHub();
    const events: VitaEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const saved: string[] = [];
    const jobs = new JobRunner(hub, async (job) => {
      saved.push(job.id);
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const first = jobs.enqueue("master", "master", async (ctx) => {
      order.push("first");
      ctx.progress({ stage: "write", round: 1 });
      ctx.addUsage({ role: "writer", model: "faux/writer", input: 4, output: 2, costUsd: 0.01 });
      await gate;
      return { scope: "resume", id: "master", sha: null };
    });
    const second = jobs.enqueue("base", "direction", async () => {
      order.push("second");
      throw new Error("Checker model faux/checker failed: fixture error");
    });
    await Promise.resolve();
    expect(first.status).toBe("queued");
    expect(order).toEqual(["first"]);
    release();
    await jobs.idle();
    expect(order).toEqual(["first", "second"]);
    expect(jobs.get(first.id)).toMatchObject({ status: "done", usage: [{ role: "writer", input: 4 }] });
    expect(jobs.get(second.id)).toMatchObject({
      status: "failed",
      error: "Checker model faux/checker failed: fixture error",
    });
    expect(saved).toEqual([first.id, second.id]);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["job.queued", "job.progress", "job.done", "job.failed", "resource.changed"]),
    );
  });
  it("cancels queued jobs and signals running jobs without freeing the queue early", async () => {
    const jobs = new JobRunner(new EventHub(), async () => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    let called = false;
    const running = jobs.enqueue("master", "master", async (ctx) => {
      signal = ctx.signal;
      await gate;
      ctx.signal.throwIfAborted();
      return { scope: "resume", id: "master", sha: null };
    });
    const queued = jobs.enqueue("base", "direction", async () => {
      called = true;
      return { scope: "resume", id: "direction", sha: null };
    });
    await Promise.resolve();
    jobs.cancel(running.id);
    jobs.cancel(queued.id);
    expect(signal?.aborted).toBe(true);
    release();
    await jobs.idle();
    expect(called).toBe(false);
    expect(jobs.get(running.id)?.status).toBe("cancelled");
    expect(jobs.get(queued.id)?.status).toBe("cancelled");
  });
});
