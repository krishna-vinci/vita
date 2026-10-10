import { expect, it } from "vitest";
import { ChangePasswordRequest, CreateUserRequest, SetupRequest, UpdateUserRequest } from "./api-auth";

it("rejects unsafe usernames and weak passwords on account creation and setup", () => {
  for (const username of ["../other", "User Name", "", "a/b", "ADMIN"]) {
    expect(SetupRequest.safeParse({ username, password: "valid-password" }).success).toBe(false);
  }
  expect(CreateUserRequest.safeParse({ username: "valid-user", password: "short" }).success).toBe(false);
  expect(ChangePasswordRequest.safeParse({ currentPassword: "old", newPassword: "short" }).success).toBe(false);
});
it("limits admin patches to mutable account fields", () => {
  for (const field of ["username", "workspace", "passwordHash", "mustChangePassword"]) {
    expect(UpdateUserRequest.safeParse({ [field]: "untrusted" }).success).toBe(false);
  }
  expect(UpdateUserRequest.parse({ isAdmin: false, disabled: true })).toEqual({ isAdmin: false, disabled: true });
});
