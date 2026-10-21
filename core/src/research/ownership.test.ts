import { Profile } from "@vita/shared";
import { expect, it, vi } from "vitest";
import { profileGitHubLogin, suggestOwnership } from "./ownership.js";

it("maps sole, team, contributor and unknown from GitHub evidence without confirming it", async () => {
  const fetcher = vi.fn<typeof fetch>();
  for (const [login, counts, suggestion] of [
    ["owner", [97, 3], "sole"],
    ["owner", [70, 30], "team"],
    ["peer", [70, 30], "contributor"],
    ["stranger", [70, 30], "unknown"],
  ] as const) {
    fetcher.mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/user")
              ? { login }
              : String(url).includes("/contributors?")
                ? [
                    { login: "owner", contributions: counts[0] },
                    { login: "peer", contributions: counts[1] },
                  ]
                : { owner: { login: "owner" } },
          ),
        ),
    );
    const result = await suggestOwnership("owner/archive", { token: "fake", fetch: fetcher });
    expect(result).toMatchObject({ suggestion, ownerLogin: "owner", userLogin: login, contributors: 2 });
    expect(result.commitShare).toBe(login === "owner" ? counts[0] / 100 : login === "peer" ? counts[1] / 100 : 0);
    expect(result.reason).toMatch(/confirm/i);
  }
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/contributors?per_page=100&anon=0"))).toBe(true);
});

it("falls back to profile handles without a token and keeps incomplete/empty evidence unknown", async () => {
  expect(profileGitHubLogin(Profile.parse({ name: "Example", contact: [{ label: "GitHub", value: "@owner" }] }))).toBe(
    "owner",
  );
  expect(
    profileGitHubLogin(Profile.parse({ name: "Example", contact: [{ label: "Web", value: "github.com/peer" }] })),
  ).toBe("peer");
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/contributors?")
            ? [{ login: "owner", contributions: 100 }]
            : { owner: { login: "owner" } },
        ),
        {
          headers: String(url).includes("contributors")
            ? { link: '<https://api.github.com/repos/owner/archive/contributors?page=2>; rel="next"' }
            : {},
        },
      ),
  );
  expect(await suggestOwnership("owner/archive", { userLogin: "owner", fetch: fetcher })).toMatchObject({
    suggestion: "unknown",
    commitShare: null,
  });
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("/user"))).toBe(false);
  fetcher.mockImplementation(
    async (url) =>
      new Response(JSON.stringify(String(url).includes("contributors") ? [] : { owner: { login: "owner" } })),
  );
  expect(await suggestOwnership("owner/archive", { userLogin: "owner", fetch: fetcher })).toMatchObject({
    suggestion: "unknown",
    contributors: 0,
  });
  fetcher.mockImplementation(async (url) =>
    String(url).includes("contributors")
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({ owner: { login: "owner" } })),
  );
  expect(await suggestOwnership("owner/archive", { userLogin: "owner", fetch: fetcher })).toMatchObject({
    suggestion: "unknown",
    contributors: 0,
  });
  await expect(suggestOwnership("../archive", { fetch: fetcher })).rejects.toThrow();
});
