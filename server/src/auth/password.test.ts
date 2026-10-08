import { describe, expect, it } from "vitest";
import { assertBindAllowed } from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";

describe("password and bind policy", () => {
  it("verifies scrypt hashes and rejects wrong passwords and malformed encodings", async () => {
    const hash = await hashPassword("fixture-password");
    expect(await verifyPassword("fixture-password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("fixture-password", "scrypt$bad")).toBe(false);
    expect(() => assertBindAllowed("0.0.0.0", hash)).not.toThrow();
    expect(() => assertBindAllowed("127.0.0.1", "invalid")).toThrow("valid scrypt");
  });
  it("refuses every non-loopback bind without a password hash", () => {
    for (const host of ["0.0.0.0", "::", "192.168.1.2", "example.test"])
      expect(() => assertBindAllowed(host)).toThrow("VITA_PASSWORD_HASH");
    for (const host of ["127.0.0.1", "::1", "localhost"]) expect(() => assertBindAllowed(host)).not.toThrow();
  });
});
