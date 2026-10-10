import type { DatabaseSync } from "node:sqlite";
import { type AccountUser, Username } from "@vita/shared";
import { transaction } from "../db/db.js";
import { ApiFailure } from "../errors.js";

export type User = AccountUser;
interface UserRow {
  id: number;
  username: string;
  display_name: string;
  is_admin: number;
  disabled: number;
  must_change_password: number;
  workspace: string | null;
  created_at: string;
  updated_at: string;
}
function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: row.is_admin === 1,
    disabled: row.disabled === 1,
    mustChangePassword: row.must_change_password === 1,
    workspace: row.workspace,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function getUser(db: DatabaseSync, username: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as UserRow | undefined;
  return row ? toUser(row) : null;
}
export function getUserById(db: DatabaseSync, id: number): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UserRow | undefined;
  return row ? toUser(row) : null;
}
export function listUsers(db: DatabaseSync): User[] {
  return (db.prepare("SELECT * FROM users ORDER BY username").all() as unknown as UserRow[]).map(toUser);
}
export function passwordHashFor(db: DatabaseSync, id: number): string | null {
  return (
    (db.prepare("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string } | undefined)
      ?.password_hash ?? null
  );
}
export function insertUser(
  db: DatabaseSync,
  input: {
    username: string;
    displayName: string;
    passwordHash: string;
    isAdmin: boolean;
    mustChangePassword?: boolean;
    workspace?: string | null;
  },
): User {
  Username.parse(input.username);
  if (getUser(db, input.username)) throw new ApiFailure(409, "user-exists", "Username already exists");
  const now = new Date().toISOString();
  const result = db
    .prepare(`INSERT INTO users
    (username, display_name, password_hash, is_admin, must_change_password, workspace, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      input.username,
      input.displayName,
      input.passwordHash,
      Number(input.isAdmin),
      Number(input.mustChangePassword ?? false),
      input.workspace ?? null,
      now,
      now,
    );
  return getUserById(db, Number(result.lastInsertRowid)) as User;
}
function guardLastAdmin(db: DatabaseSync, user: User): void {
  if (!user.isAdmin || user.disabled) return;
  const row = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1 AND disabled = 0").get() as {
    count: number;
  };
  if (row.count <= 1)
    throw new ApiFailure(409, "last-admin", "The last enabled admin cannot be removed, disabled or demoted");
}
export function updateUser(
  db: DatabaseSync,
  username: string,
  patch: {
    displayName?: string;
    isAdmin?: boolean;
    disabled?: boolean;
  },
): User {
  return transaction(db, () => {
    const user = getUser(db, username);
    if (!user) throw new ApiFailure(404, "not-found", "Account not found");
    if (patch.isAdmin === false || patch.disabled === true) guardLastAdmin(db, user);
    db.prepare("UPDATE users SET display_name = ?, is_admin = ?, disabled = ?, updated_at = ? WHERE id = ?").run(
      patch.displayName ?? user.displayName,
      Number(patch.isAdmin ?? user.isAdmin),
      Number(patch.disabled ?? user.disabled),
      new Date().toISOString(),
      user.id,
    );
    if (patch.disabled === true || patch.isAdmin === false)
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    return getUserById(db, user.id) as User;
  });
}
export function deleteUser(db: DatabaseSync, username: string): User {
  return transaction(db, () => {
    const user = getUser(db, username);
    if (!user) throw new ApiFailure(404, "not-found", "Account not found");
    guardLastAdmin(db, user);
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    return user;
  });
}
export function changePassword(
  db: DatabaseSync,
  id: number,
  hash: string,
  mustChange = false,
  exceptHash?: string,
): void {
  transaction(db, () => {
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?").run(
      hash,
      Number(mustChange),
      new Date().toISOString(),
      id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(id, exceptHash ?? "");
  });
}
