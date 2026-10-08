import type { VitaEvent } from "@vita/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventHub } from "../events.js";

export function eventsRoutes(hub: EventHub): Hono {
  const app = new Hono();
  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const queue: VitaEvent[] = [];
      let wake: (() => void) | undefined;
      let aborted = false;
      const unsubscribe = hub.subscribe((event) => {
        if (queue.length >= 500) {
          aborted = true;
          wake?.();
          return;
        }
        queue.push(event);
        wake?.();
      });
      const heartbeat = setInterval(() => {
        void stream.write(": keep-alive\n\n").catch(() => {
          aborted = true;
          wake?.();
        });
      }, 25_000);
      stream.onAbort(() => {
        aborted = true;
        wake?.();
      });
      try {
        await stream.write(": connected\n\n");
        while (!aborted) {
          const event = queue.shift();
          if (event) await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }),
  );
  return app;
}
