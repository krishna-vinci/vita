import { OwnershipQuery, type OwnershipSuggestion, type Profile } from "@vita/shared";
import { GitHubClient } from "./github.js";
import type { WebFetch } from "./web.js";

export function profileGitHubLogin(profile: Profile): string | undefined {
  for (const contact of profile.contact) {
    for (const value of [contact.url, contact.value]) {
      if (!value) continue;
      const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w-]+)\/?$/i.exec(value.trim());
      if (match?.[1]) return match[1];
    }
    if (/github/i.test(contact.label) && /^@?[\w-]+$/.test(contact.value.trim()))
      return contact.value.trim().replace(/^@/, "");
  }
  return undefined;
}

/** Advisory only: callers must never write this suggestion into source metadata. */
export async function suggestOwnership(
  repo: string,
  options: { token?: string; userLogin?: string; fetch?: WebFetch; signal?: AbortSignal } = {},
): Promise<OwnershipSuggestion> {
  OwnershipQuery.parse({ repo });
  const client = new GitHubClient(options.token, options.fetch);
  const base = `https://api.github.com/repos/${repo}`;
  const [metadata, contributors, user] = await Promise.all([
    client.request<{ owner: { login: string } }>(base, options.signal),
    client.request<{ login: string; contributions: number }[] | null>(
      `${base}/contributors?per_page=100&anon=0`,
      options.signal,
    ),
    options.token ? client.request<{ login: string }>("https://api.github.com/user", options.signal) : undefined,
  ]);
  const ownerLogin = metadata.data.owner.login;
  const userLogin = user?.data.login ?? options.userLogin ?? null;
  const rows = contributors.data ?? [];
  const total = rows.reduce((sum, row) => sum + row.contributions, 0);
  const own = rows.find((row) => row.login.toLowerCase() === userLogin?.toLowerCase())?.contributions ?? 0;
  const truncated = /rel="next"/.test(contributors.headers.get("link") ?? "");
  const commitShare = userLogin && total > 0 && !truncated ? own / total : null;
  let suggestion: OwnershipSuggestion["suggestion"] = "unknown";
  let reason = !userLogin
    ? "Connect GitHub or add a GitHub contact to identify your contributions."
    : truncated
      ? "The contributor list is incomplete; confirm your role."
      : !total || !own
        ? "No commits attributed to your login were found; confirm your role."
        : "Confirm your role before using this suggestion.";
  if (commitShare !== null && own > 0) {
    const owner = ownerLogin.toLowerCase() === userLogin?.toLowerCase();
    suggestion = owner ? (commitShare >= 0.9 ? "sole" : "team") : "contributor";
    reason = `You ${owner ? "own the repository and" : "contributed to the repository and"} wrote ${Math.round(commitShare * 100)}% of ${total} listed commits (${rows.length} contributors). Confirm your role.`;
  }
  return { suggestion, reason, ownerLogin, userLogin, commitShare, contributors: rows.length };
}
