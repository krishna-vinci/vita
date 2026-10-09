import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { verifyPassword } from "../../../server/src/auth/password.js";
import { hashPasswordCommand } from "./hash-password";

afterEach(() => vi.restoreAllMocks());

it("prints a server-compatible hash, preserving spaces and split UTF-8 bytes", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const password = "  example café password  ";
  const bytes = Buffer.from(`${password}\r\n`);
  const split = bytes.indexOf(0xc3) + 1;
  await hashPasswordCommand(Readable.from([bytes.subarray(0, split), bytes.subarray(split)]));
  expect(output).toHaveBeenCalledTimes(1);
  const hash = String(output.mock.calls[0]?.[0]);
  expect(hash).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}\n$/);
  expect(await verifyPassword(password, hash.trimEnd())).toBe(true);
  expect(await verifyPassword(password.trim(), hash.trimEnd())).toBe(false);
});

it("accepts stdin without a trailing newline", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  await hashPasswordCommand(Readable.from(["example password"]));
  expect(await verifyPassword("example password", String(output.mock.calls[0]?.[0]).trimEnd())).toBe(true);
});

it("rejects empty or multiline input without printing a hash", async () => {
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  for (const input of ["", "\n", "first\nsecond\n", "first\rsecond"]) {
    await expect(hashPasswordCommand(Readable.from([input]))).rejects.toThrow("one non-empty password");
  }
  expect(output).not.toHaveBeenCalled();
});
