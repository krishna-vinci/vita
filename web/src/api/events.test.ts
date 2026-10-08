import { QueryClient } from "@tanstack/react-query";
import type { JobView, VitaEvent } from "@vita/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invalidateEvent, subscribeVitaEvents } from "./events";
import { queryKeys } from "./keys";

const job: JobView = {
  id: "job-1",
  kind: "tailor",
  resourceId: "sample",
  status: "running",
  progress: "Writing",
  createdAt: "2026-10-09",
  startedAt: null,
  finishedAt: null,
  usage: [],
};
afterEach(() => vi.unstubAllGlobals());
describe("shared SSE", () => {
  it("uses one connection for multiple subscribers, ignores bad messages and closes when idle", () => {
    const handlers = new Map<string, (event: { data: string }) => void>();
    const close = vi.fn();
    const EventSource = vi.fn(
      class {
        addEventListener(type: string, handler: (event: { data: string }) => void) {
          handlers.set(type, handler);
        }
        close = close;
      },
    );
    vi.stubGlobal("EventSource", EventSource);
    const first = vi.fn(),
      second = vi.fn();
    const stopFirst = subscribeVitaEvents(first),
      stopSecond = subscribeVitaEvents(second);
    expect(EventSource).toHaveBeenCalledTimes(1);
    expect(EventSource).toHaveBeenCalledWith("/api/events");
    handlers.get("resource.changed")?.({ data: "bad JSON" });
    handlers.get("job.done")?.({ data: JSON.stringify({ type: "job.done", job: {} }) });
    expect(first).not.toHaveBeenCalled();
    const event = { type: "resource.changed", scope: "outline", sha: null };
    handlers.get("resource.changed")?.({ data: JSON.stringify(event) });
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);
    stopFirst();
    expect(close).not.toHaveBeenCalled();
    stopSecond();
    expect(close).toHaveBeenCalledTimes(1);
    const stopThird = subscribeVitaEvents(first);
    expect(EventSource).toHaveBeenCalledTimes(2);
    stopThird();
  });
  it("invalidates the changed resource and workspace, including cached detail queries", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.application("sample"), {});
    client.setQueryData(queryKeys.resume("master"), {});
    const spy = vi.spyOn(client, "invalidateQueries");
    for (const [scope, key] of [
      ["outline", queryKeys.outline],
      ["projects", queryKeys.projects],
      ["settings", queryKeys.settings],
      ["resume", queryKeys.resumes],
      ["application", queryKeys.applications],
    ] as const) {
      spy.mockClear();
      invalidateEvent(client, { type: "resource.changed", scope, id: "sample", sha: null });
      expect(spy.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([key, queryKeys.workspace]);
    }
    expect(client.getQueryState(queryKeys.application("sample"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.resume("master"))?.isInvalidated).toBe(true);
    client.clear();
  });
  it("updates job status and invalidates the correct resources for every job event", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    for (const type of ["job.queued", "job.progress", "job.done", "job.failed"] as const) {
      for (const kind of ["master", "base", "tailor", "answers"] as const) {
        spy.mockClear();
        const event: VitaEvent = { type, job: { ...job, kind } };
        invalidateEvent(client, event);
        expect(client.getQueryData(queryKeys.job(job.id))).toEqual(event.job);
        expect(spy.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([
          queryKeys.jobs,
          kind === "master" || kind === "base" ? queryKeys.resumes : queryKeys.applications,
          queryKeys.workspace,
        ]);
      }
    }
    client.clear();
  });
});
