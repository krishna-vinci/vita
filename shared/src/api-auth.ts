import { z } from "zod";
import { Slug } from "./ids";

export const Username = Slug;
export const AccountUser = z.object({
  id: z.number().int().positive(),
  username: Username,
  displayName: z.string(),
  isAdmin: z.boolean(),
  disabled: z.boolean(),
  mustChangePassword: z.boolean(),
  workspace: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AccountUser = z.infer<typeof AccountUser>;
export const AuthState = z.object({
  setupRequired: z.boolean(),
  setupCodeRequired: z.boolean(),
  user: AccountUser.nullable(),
});
export type AuthState = z.infer<typeof AuthState>;
export const AccountPassword = z.string().min(8).max(1024);
export const SetupRequest = z.object({
  username: Username,
  displayName: z.string().trim().max(200).default(""),
  password: AccountPassword,
  setupCode: z.string().max(200).optional(),
});
export const LoginRequest = z.object({ username: z.string().max(64), password: z.string().max(1024) });
export const ChangePasswordRequest = z.object({ currentPassword: z.string().max(1024), newPassword: AccountPassword });
export const CreateUserRequest = SetupRequest.omit({ setupCode: true }).extend({
  isAdmin: z.boolean().default(false),
  workspace: z.string().min(1).max(4096).optional(),
});
export const UpdateUserRequest = z
  .object({
    displayName: z.string().trim().max(200).optional(),
    isAdmin: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();
export const ResetPasswordRequest = z.object({ password: AccountPassword });
export const UserResult = z.object({ user: AccountUser });
export const UsersResult = z.object({ users: z.array(AccountUser) });
export const DeleteUserResult = z.object({ username: Username, workspace: z.string() });
