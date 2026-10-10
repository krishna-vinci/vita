import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { insertUser, listUsers } from "../accounts/users.js";
import { openDb } from "./db.js";

it("migrates once and persists private account data across database reopen", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vita-db-"));
  const file = path.join(dir, "vita.db");
  try {
    const first = openDb(file);
    insertUser(first, { username: "admin", displayName: "Fictional", passwordHash: "fixture-hash", isAdmin: true });
    first.close();
    const second = openDb(file);
    try {
      expect(listUsers(second)).toHaveLength(1);
      expect(second.prepare("SELECT COUNT(*) AS count FROM migrations").get()).toMatchObject({ count: 1 });
      expect(
        second
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name),
      ).toEqual(expect.arrayContaining(["users", "sessions", "settings", "migrations"]));
    } finally {
      second.close();
    }
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("wires Docker startup to the accounts data layout and public health endpoint", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  const compose = await readFile(path.join(root, "compose.yaml"), "utf8");
  expect(dockerfile).toContain("VITA_DATA_DIR=/data");
  expect(dockerfile).not.toContain("VITA_PASSWORD_HASH");
  expect(dockerfile).not.toContain('init "$VITA_WORKSPACE"');
  expect(dockerfile).toContain("if (!r.ok || b.ok !== true) process.exit(1)");
  expect(compose).toContain("VITA_DATA_DIR: /data");
  expect(compose).toContain("./vita-home:/data");
});
