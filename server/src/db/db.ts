import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.js";

export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  migrate(db);
  return db;
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function migrate(db: DatabaseSync): void {
  transaction(db, () => {
    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version > migrations.length) throw new Error("Accounts database is newer than this server");
    for (let index = version; index < migrations.length; index++) {
      db.exec(migrations[index] ?? "");
      db.prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)").run(index + 1, new Date().toISOString());
      db.exec(`PRAGMA user_version=${index + 1}`);
    }
  });
}
