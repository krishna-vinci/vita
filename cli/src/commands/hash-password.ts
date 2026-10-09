import { hashPassword } from "../../../server/src/auth/password.js";

export async function hashPasswordCommand(input: AsyncIterable<string | Buffer> = process.stdin): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  const password = Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
  if (!password || /[\r\n]/.test(password)) throw new Error("Supply one non-empty password on stdin.");
  process.stdout.write(`${await hashPassword(password)}\n`);
}
