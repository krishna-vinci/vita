import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";

afterEach(() => vi.unstubAllGlobals());
describe("API client", () => {
  it("preserves structured conflict errors for callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "conflict", message: "The outline changed. Reload before saving." } }),
            { status: 409 },
          ),
        ),
    );
    await expect(api.outline.save({ markdown: "Hello", baseHash: "old" })).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      message: "The outline changed. Reload before saving.",
    });
  });
  it("reports non-JSON and network failures without exposing response text", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>proxy error</html>", { status: 502 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(api.settings.get()).rejects.toMatchObject({ status: 502, code: "request-failed" });
    await expect(api.settings.get()).rejects.toMatchObject({ status: 0, code: "network-error" });
  });
  it("sends typed settings as JSON and rejects unreadable success responses", async () => {
    const settings = { models: { default: "faux/echo", roles: {} }, template: "rover-base" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...settings, providers: [], warnings: [], sha: null })))
      .mockResolvedValueOnce(new Response("bad JSON"));
    vi.stubGlobal("fetch", fetch);
    await expect(api.settings.save(settings)).resolves.toMatchObject(settings);
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        body: JSON.stringify(settings),
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(api.workspace()).rejects.toBeInstanceOf(ApiError);
  });
});
