import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { insertUser } from "../accounts/users.js";
import { openDb } from "./db.js";
import { SecretStore } from "./secret.js";

it("round-trips encrypted per-user secrets across reopen with a private key and fresh IVs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vita-secrets-"));
  let db = openDb(path.join(dir, "vita.db"));
  try {
    const user = insertUser(db, { username: "fictional", displayName: "", passwordHash: "fixture", isAdmin: false });
    const other = insertUser(db, { username: "other", displayName: "", passwordHash: "fixture", isAdmin: false });
    const store = new SecretStore(db, dir);
    expect(store.get(user.id, "github")).toBeUndefined();
    store.put(user.id, "github", "fixture_private_token");
    const first = db.prepare("SELECT * FROM secrets").get();
    expect(Buffer.from(first?.ciphertext as Uint8Array).toString()).not.toContain("fixture_private_token");
    expect(store.get(user.id, "github")).toBe("fixture_private_token");
    expect(store.get(other.id, "github")).toBeUndefined();
    store.put(user.id, "github", "fixture_private_token");
    expect(db.prepare("SELECT iv FROM secrets").get()?.iv).not.toEqual(first?.iv);
    expect((await stat(path.join(dir, "secret.key"))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(dir, "secret.key"))).toHaveLength(32);
    db.close();
    db = openDb(path.join(dir, "vita.db"));
    const reopened = new SecretStore(db, dir);
    expect(reopened.get(user.id, "github")).toBe("fixture_private_token");
    reopened.delete(user.id, "github");
    expect(reopened.get(user.id, "github")).toBeUndefined();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

it("authenticates ciphertext and its owner, rejecting tampering and cascading user deletion", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vita-secrets-"));
  const db = openDb(":memory:");
  try {
    const user = insertUser(db, { username: "fictional", displayName: "", passwordHash: "fixture", isAdmin: false });
    const other = insertUser(db, { username: "other", displayName: "", passwordHash: "fixture", isAdmin: false });
    const store = new SecretStore(db, dir);
    store.put(user.id, "github", "fixture_token");
    db.prepare("UPDATE secrets SET user_id = ? WHERE user_id = ?").run(other.id, user.id);
    expect(() => store.get(other.id, "github")).toThrow();
    db.prepare("DELETE FROM users WHERE id = ?").run(other.id);
    expect(db.prepare("SELECT COUNT(*) AS count FROM secrets").get()).toMatchObject({ count: 0 });
    store.put(user.id, "github", "fixture_token");
    db.prepare("UPDATE secrets SET tag = ?").run(Buffer.alloc(16));
    expect(() => store.get(user.id, "github")).toThrow();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
