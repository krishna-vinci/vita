import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { VitaEvent } from "@vita/shared";
import { useEffect, useRef } from "react";
import { queryKeys } from "./keys";

type Listener = (event: VitaEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;

export function subscribeVitaEvents(listener: Listener): () => void {
  listeners.add(listener);
  if (!source) {
    source = new EventSource("/api/events");
    for (const type of ["job.queued", "job.progress", "job.done", "job.failed", "resource.changed"]) {
      source.addEventListener(type, (raw) => {
        try {
          const event = VitaEvent.safeParse(JSON.parse((raw as MessageEvent<string>).data));
          if (event.success) for (const subscriber of listeners) subscriber(event.data);
        } catch {
          // Ignore malformed messages; the browser owns SSE reconnection.
        }
      });
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close();
      source = null;
    }
  };
}

export function invalidateEvent(client: QueryClient, event: VitaEvent): void {
  const invalidate = (queryKey: readonly string[]) => void client.invalidateQueries({ queryKey });
  if (event.type === "resource.changed") {
    const scoped = { resume: "resumes", application: "applications", template: "templates" } as const;
    invalidate(
      queryKeys[event.scope in scoped ? scoped[event.scope as keyof typeof scoped] : (event.scope as "outline")],
    );
    if (event.scope === "outline" || event.scope === "resume") invalidate(queryKeys.sync);
    if (event.scope === "application") {
      invalidate(["prep"]);
      invalidate(["letter"]);
      invalidate(queryKeys.tracker);
    }
    if (event.scope === "outline") invalidate(["onboarding"]);
    if (event.scope === "settings")
      for (const key of [queryKeys.instructions, queryKeys.rules, queryKeys.mcp, queryKeys.metrics, queryKeys.memory])
        invalidate(key);
    if (event.scope === "projects") invalidate(queryKeys.metrics);
    invalidate(queryKeys.workspace);
    return;
  }
  client.setQueryData(queryKeys.job(event.job.id), event.job);
  invalidate(queryKeys.jobs);
  if (event.job.kind === "master" || event.job.kind === "base") invalidate(queryKeys.resumes);
  else if (event.job.kind === "template-adoption") invalidate(queryKeys.templates);
  else {
    invalidate(queryKeys.applications);
    if (event.job.kind === "prep") invalidate(["prep"]);
  }
  invalidate(queryKeys.workspace);
}

export function useVitaEvents(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeVitaEvents((event) => ref.current(event)), []);
}

/** Mount once in the shell; page subscribers share the same EventSource. */
export function useEventInvalidation(): void {
  const client = useQueryClient();
  useVitaEvents((event) => invalidateEvent(client, event));
  useEffect(() => {
    // A reconnect can follow missed events. Refetch cached resources once it opens.
    const refresh = () => void client.invalidateQueries();
    const stream = source;
    stream?.addEventListener("open", refresh);
    return () => stream?.removeEventListener("open", refresh);
  }, [client]);
}
