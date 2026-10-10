import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSession, resolveSession } from "../../../server/src/accounts/sessions.js";
import { getUser, insertUser, passwordHashFor } from "../../../server/src/accounts/users.js";
import { hashPassword, verifyPassword } from "../../../server/src/auth/password.js";
import { openDb } from "../../../server/src/db/db.js";
import { createProgram } from "../index.js";
import { resetPasswordCommand, usersCommand } from "./accounts.js";

let dir: string;
let db: ReturnType<typeof openDb>;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vita-cli-accounts-"));
  db = openDb(path.join(dir, "vita.db"));
  insertUser(db, {
    username: "admin",
    displayName: "Admin",
    passwordHash: await hashPassword("old-password"),
    isAdmin: true,
  });
});
afterEach(async () => {
  db.close();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
function requiredUser(username: string) {
  const user = getUser(db, username);
  if (!user) throw new Error(`Missing fixture user ${username}`);
  return user;
}
async function* stdin(value: string) {
  yield value;
}
it("resets a persisted account password from stdin and revokes every session", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const user = requiredUser("admin");
  const session = createSession(db, user.id);
  const password = "new-🙂-password";
  const encoded = Buffer.from(`${password}\r\n`);
  async function* splitInput() {
    yield encoded.subarray(0, 5);
    yield encoded.subarray(5);
  }
  await resetPasswordCommand("admin", splitInput(), dir);
  expect(await verifyPassword(password, passwordHashFor(db, user.id) ?? "")).toBe(true);
  expect(resolveSession(db, session.token)).toBeNull();
  expect(output).toHaveBeenCalledWith(expect.stringContaining("all sessions signed out"));
});
it("lists safe account metadata and registers account commands with legacy hash help", () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  usersCommand(dir);
  expect(output.mock.calls.flat().join("")).toContain(path.join(dir, "users", "admin"));
  expect(output.mock.calls.flat().join("")).not.toContain("scrypt$");
  const program = createProgram();
  expect(program.commands.map((command) => command.name())).toEqual(
    expect.arrayContaining(["users", "reset-password"]),
  );
  expect(program.commands.find((command) => command.name() === "hash-password")?.description()).toContain("Legacy");
});
it("rejects unknown users, weak or multiline passwords and missing databases without changing credentials", async () => {
  const user = requiredUser("admin");
  const hash = passwordHashFor(db, user.id);
  await expect(resetPasswordCommand("missing", stdin("new-password"), dir)).rejects.toThrow("No user named missing");
  await expect(resetPasswordCommand("admin", stdin("short"), dir)).rejects.toThrow();
  await expect(resetPasswordCommand("admin", stdin("new-password\nother\n"), dir)).rejects.toThrow(
    "Supply one password",
  );
  expect(passwordHashFor(db, user.id)).toBe(hash);
  expect(() => usersCommand(path.join(dir, "missing"))).toThrow("No accounts database");
});
