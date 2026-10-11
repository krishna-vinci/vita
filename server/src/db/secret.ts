import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

function loadKey(dataDir: string): Buffer {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "secret.key");
  try {
    const descriptor = openSync(file, "wx", 0o600);
    try {
      writeFileSync(descriptor, randomBytes(32));
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const key = readFileSync(descriptor);
    if (key.length !== 32) throw new Error("Invalid secret encryption key");
    chmodSync(file, 0o600);
    return key;
  } finally {
    closeSync(descriptor);
  }
}
interface SecretRow {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}

/** Server data only. AAD binds ciphertext to its user and secret name. */
export class SecretStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string,
  ) {}
  get(userId: number, name: string): string | undefined {
    const row = this.db
      .prepare("SELECT ciphertext, iv, tag FROM secrets WHERE user_id = ? AND name = ?")
      .get(userId, name) as unknown as SecretRow | undefined;
    if (!row) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", loadKey(this.dataDir), row.iv);
    decipher.setAAD(Buffer.from(JSON.stringify([userId, name])));
    decipher.setAuthTag(Buffer.from(row.tag));
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  }
  put(userId: number, name: string, plaintext: string): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", loadKey(this.dataDir), iv);
    cipher.setAAD(Buffer.from(JSON.stringify([userId, name])));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    this.db
      .prepare(`INSERT INTO secrets (user_id, name, ciphertext, iv, tag, updated)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET
      ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag, updated = excluded.updated`)
      .run(userId, name, ciphertext, iv, cipher.getAuthTag(), new Date().toISOString());
  }
  delete(userId: number, name: string): void {
    this.db.prepare("DELETE FROM secrets WHERE user_id = ? AND name = ?").run(userId, name);
  }
}
