import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("verifies scrypt hashes and rejects wrong passwords and malformed encodings", async () => {
    const hash = await hashPassword("fixture-password");
    expect(await verifyPassword("fixture-password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("fixture-password", "scrypt$bad")).toBe(false);
  });
});
