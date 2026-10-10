import { existsSync } from "node:fs";
import path from "node:path";
import { AccountPassword } from "@vita/shared";
import { changePassword, getUser, listUsers } from "../../../server/src/accounts/users.js";
import { hashPassword } from "../../../server/src/auth/password.js";
import { openDb } from "../../../server/src/db/db.js";

function accountsDb(dataDir = process.env.VITA_DATA_DIR ?? "./vita-home") {
  const file = path.resolve(dataDir, "vita.db");
  if (!existsSync(file))
    throw new Error(`No accounts database at ${file}; set VITA_DATA_DIR to the server's data directory.`);
  return openDb(file);
}
export async function resetPasswordCommand(
  username: string,
  input: AsyncIterable<string | Buffer> = process.stdin,
  dataDir?: string,
): Promise<void> {
  const db = accountsDb(dataDir);
  try {
    const user = getUser(db, username);
    if (!user) throw new Error(`No user named ${username}`);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of input) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += buffer.length;
      if (bytes > 8192) throw new Error("Password input is too long");
      chunks.push(buffer);
    }
    let password = Buffer.concat(chunks).toString("utf8");
    password = password.replace(/\r?\n$/, "");
    if (/[\r\n]/.test(password)) throw new Error("Supply one password on stdin");
    AccountPassword.parse(password);
    changePassword(db, user.id, await hashPassword(password));
    process.stdout.write(`Password updated for ${username}; all sessions signed out.\n`);
  } finally {
    db.close();
  }
}
export function usersCommand(dataDir?: string): void {
  const db = accountsDb(dataDir);
  try {
    process.stdout.write("USERNAME\tDISPLAY NAME\tADMIN\tDISABLED\tMUST CHANGE PASSWORD\tWORKSPACE\n");
    for (const user of listUsers(db)) {
      const workspace = path.resolve(
        user.workspace ?? path.join(dataDir ?? process.env.VITA_DATA_DIR ?? "./vita-home", "users", user.username),
      );
      process.stdout.write(
        `${user.username}\t${user.displayName.replace(/[\r\n\t]/g, " ")}\t${user.isAdmin}\t${user.disabled}\t${user.mustChangePassword}\t${workspace}\n`,
      );
    }
  } finally {
    db.close();
  }
}
