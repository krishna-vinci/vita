import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { insertUser } from "../accounts/users.js";
import { openDb } from "../db/db.js";
import { requestGuard } from "./middleware.js";

let db: ReturnType<typeof openDb>;
beforeEach(() => {
  db = openDb(":memory:");
});
afterEach(() => db.close());
function app(loopback = true, publicOrigins: string[] = []) {
  const a = new Hono();
  a.use("*", requestGuard(db, loopback, publicOrigins));
  a.post("/x", (c) => c.json({ ok: true }));
  a.get("/x", (c) => c.json({ ok: true }));
  return a;
}
it("guards loopback Host before setup only, and allows code-protected remote setup", async () => {
  expect((await app().request("http://evil.example/x")).status).toBe(403);
  expect((await app().request("http://127.0.0.1:4317/x")).status).toBe(200);
  expect((await app(false).request("http://vita.example/x")).status).toBe(200);
  insertUser(db, { username: "admin", displayName: "", passwordHash: "fixture", isAdmin: true });
  expect((await app().request("http://vita.example/x")).status).toBe(200);
});
it("accepts host-based and explicit Origins and rejects foreign or malformed Origins", async () => {
  const request = (origin: string, origins: string[] = []) =>
    app(true, origins).request("http://localhost:4317/x", {
      method: "POST",
      headers: { Host: "localhost:4317", Origin: origin },
    });
  expect((await request("https://localhost:4317")).status).toBe(200);
  expect((await request("https://attacker.example")).status).toBe(403);
  expect((await request("null")).status).toBe(403);
  expect((await request("https://vita.example.org", ["https://vita.example.org"])).status).toBe(200);
});
