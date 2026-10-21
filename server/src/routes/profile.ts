import { fileHash, readText, writeProfile } from "@vita/core";
import { Profile, PutProfileRequest } from "@vita/shared";
import { type Context, Hono } from "hono";
import { parse } from "yaml";
import { ZodError } from "zod";
import { ApiFailure } from "../errors.js";
import type { WorkspaceRuntime } from "../runtime.js";

async function json(c: Context): Promise<unknown> {
  try {
    return JSON.parse(await c.req.text());
  } catch (error) {
    if (error instanceof ZodError) throw error;
    throw new ApiFailure(400, "invalid-json", "Request body must be valid JSON");
  }
}

/** The header facts in profile.yaml: name, headline, location, contacts and the default project role. */
export function profileRoutes(runtime: WorkspaceRuntime): Hono {
  const app = new Hono();
  const read = async () => {
    const hash = (await fileHash(runtime.ws.root, "profile.yaml")) ?? "";
    if (!hash) return { profile: null, hash };
    const parsed = Profile.safeParse(parse(await readText(runtime.ws.root, "profile.yaml")) ?? {});
    return { profile: parsed.success ? parsed.data : null, hash };
  };
  app.get("/profile", async (c) => c.json(await read()));
  app.put("/profile", async (c) => {
    const input = PutProfileRequest.parse(await json(c));
    return c.json(
      await runtime.exclusive(async () => {
        const current = (await fileHash(runtime.ws.root, "profile.yaml")) ?? "";
        if (input.baseHash !== current)
          throw new ApiFailure(409, "stale-hash", "Your profile changed elsewhere. Reload it and try again.");
        const { sha } = await writeProfile(runtime.ws.root, input.profile, input.baseHash);
        runtime.changed("settings", sha);
        return { ...(await read()), sha };
      }),
    );
  });
  return app;
}
