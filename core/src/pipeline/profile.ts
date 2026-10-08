import { Profile } from "@vita/shared";
import { parse } from "yaml";
import { optionalText } from "./context.js";

export class ProfileRequiredError extends Error {
  readonly code = "profile-required";

  constructor() {
    super("Add your name in profile.yaml first");
    this.name = "ProfileRequiredError";
  }
}

export async function loadProfile(root: string): Promise<Profile> {
  const text = await optionalText(root, "profile.yaml");
  if (text === undefined) throw new ProfileRequiredError();
  const value = parse(text);
  if (typeof value?.name !== "string" || !value.name.trim()) throw new ProfileRequiredError();
  return Profile.parse(value);
}
