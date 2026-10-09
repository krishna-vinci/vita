import { Hono } from "hono";
import { expect, it } from "vitest";
import { passwordAuth } from "./middleware.js";

function app(hash?: string, publicOrigins: string[] = []) {
  const a = new Hono();
  a.use("*", passwordAuth(hash, publicOrigins));
  a.post("/x", (c) => c.json({ ok: true }));
  a.get("/x", (c) => c.json({ ok: true }));
  return a;
}

it("rejects non-loopback Host headers when no password is set (DNS rebinding)", async () => {
  const res = await app().request("http://evil.example/x", { headers: { Host: "evil.example" } });
  expect(res.status).toBe(403);
  const ok = await app().request("http://127.0.0.1:4317/x", { headers: { Host: "127.0.0.1:4317" } });
  expect(ok.status).toBe(200);
});

it("accepts a same-host Origin behind a TLS proxy and an explicit public origin", async () => {
  const sameHost = await app().request("http://localhost:4317/x", {
    method: "POST",
    headers: { Host: "localhost:4317", Origin: "https://localhost:4317" },
  });
  expect(sameHost.status).toBe(200);
  const crossSite = await app().request("http://localhost:4317/x", {
    method: "POST",
    headers: { Host: "localhost:4317", Origin: "https://attacker.example" },
  });
  expect(crossSite.status).toBe(403);
  const listed = await app().request("http://localhost:4317/x", {
    method: "POST",
    headers: { Host: "localhost:4317", Origin: "https://vita.example.org" },
  });
  expect(listed.status).toBe(403);
  const allowed = await app(undefined, ["https://vita.example.org"]).request("http://localhost:4317/x", {
    method: "POST",
    headers: { Host: "localhost:4317", Origin: "https://vita.example.org" },
  });
  expect(allowed.status).toBe(200);
});
