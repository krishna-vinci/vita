import { expect, it } from "vitest";
import { Profile } from "./index";

it("requires a string name and accepts optional profile fields and contact URLs", () => {
  expect(Profile.parse({ name: "Alex Example" })).toEqual({ name: "Alex Example", contact: [] });
  const profile = {
    name: "Alex Example",
    headline: "Coordinator",
    location: "Example City",
    contact: [{ label: "Web", value: "Portfolio", url: "https://example.test" }],
  };
  expect(Profile.parse(profile)).toEqual(profile);
  expect(Profile.safeParse({ contact: [] }).success).toBe(false);
  expect(Profile.safeParse({ name: 123 }).success).toBe(false);
});
