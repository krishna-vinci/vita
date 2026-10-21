import { Type } from "typebox";
import { type ToolDefinition, wrapUntrusted } from "../agent/index.js";
import type { WebFetch } from "./web.js";

export const MAX_README_BYTES = 8 * 1024;
export const MAX_GITHUB_FILE_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** Only fixed GitHub hosts, including every redirect; never echo response errors or credentials. */
export class GitHubClient {
  constructor(
    readonly token?: string,
    private readonly fetcher: WebFetch = fetch,
  ) {}

  async request<T>(value: string, signal?: AbortSignal, textMatch = false): Promise<{ data: T; headers: Headers }> {
    const timeout = AbortSignal.timeout(15_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let url = new URL(value);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        combined.throwIfAborted();
        if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port || url.username || url.password)
          throw new GitHubError(400, "GitHub request host is not on the allow-list.");
        const response = await this.fetcher(url.href, {
          redirect: "manual",
          signal: combined,
          headers: {
            Accept: textMatch
              ? "application/vnd.github+json, application/vnd.github.text-match+json"
              : "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "vita",
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location) throw new GitHubError(502, "GitHub redirect has no location.");
          url = new URL(location, url);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 404)
            throw new GitHubError(
              404,
              "GitHub repository or path not found. Check the name; for private repositories add a token in Settings → Integrations.",
            );
          if ([403, 429].includes(response.status)) {
            const reset = Number(response.headers.get("x-ratelimit-reset"));
            const retry = Number(response.headers.get("retry-after"));
            const time = reset > 0 ? new Date(reset * 1000) : retry > 0 ? new Date(Date.now() + retry * 1000) : null;
            throw new GitHubError(
              response.status,
              `GitHub rate limit or access denied. Reset: ${time && Number.isFinite(time.getTime()) ? time.toISOString() : "not provided by GitHub"}. Check token permissions or try after the reset.`,
            );
          }
          throw new GitHubError(
            response.status,
            response.status === 401
              ? "GitHub token is invalid or expired. Update it in Settings → Integrations."
              : `GitHub request failed (${response.status}).`,
          );
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            while (true) {
              combined.throwIfAborted();
              const { done, value: chunk } = await reader.read();
              if (done) break;
              size += chunk.byteLength;
              if (size > MAX_RESPONSE_BYTES) throw new GitHubError(413, "GitHub response exceeds the size limit.");
              chunks.push(chunk);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
        }
        return {
          data: (response.status === 204 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8"))) as T,
          headers: response.headers,
        };
      }
      throw new GitHubError(502, "Too many GitHub redirects.");
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)))
        throw new GitHubError(504, "GitHub request timed out after 15 seconds. Try again.");
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(502, "GitHub request failed. Check connectivity and try again.");
    }
  }
}

interface Repo {
  description: string | null;
  default_branch: string;
  topics?: string[];
  stargazers_count: number;
  pushed_at: string;
  license: { spdx_id: string; name: string } | null;
}
interface Content {
  type: string;
  encoding: string;
  content: string;
  size: number;
}
interface Commit {
  sha: string;
  commit: { message: string; author: { date: string }; tree: { sha: string } };
  author: { login: string } | null;
}
interface Args {
  owner: string;
  repo: string;
  path?: string;
  ref?: string;
  limit?: number;
  query?: string;
}

function repoPath(args: Args): string {
  if (![args.owner, args.repo].every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && ![".", ".."].includes(part)))
    throw new GitHubError(400, "Expected a GitHub owner and repository name, without URLs or slashes.");
  return `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;
}
function filePath(path: string): string {
  if (
    !path ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.includes("\\") ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    throw new GitHubError(400, "Expected a repository-relative file path.");
  return path.split("/").map(encodeURIComponent).join("/");
}
function decode(content: Content, cap: number, excerpt = false): string {
  if (content.type !== "file" || content.encoding !== "base64")
    throw new GitHubError(422, "GitHub supports text files only; binary files, directories and links are refused.");
  if (!excerpt && content.size > cap) throw new GitHubError(413, "GitHub file exceeds 64 KB.");
  const bytes = Buffer.from(content.content, "base64");
  if (!excerpt && bytes.length > cap) throw new GitHubError(413, "GitHub file exceeds 64 KB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new GitHubError(422, "GitHub binary file refused; expected UTF-8 text.");
  }
  if (bytes.some((byte) => (byte < 32 && ![9, 10, 13].includes(byte)) || byte === 127))
    throw new GitHubError(422, "GitHub binary file refused; expected text.");
  // Drop an incomplete final character so the byte cap holds for multibyte UTF-8 too.
  return bytes.length > cap ? new TextDecoder().decode(bytes.subarray(0, cap), { stream: true }) : text;
}

export function githubTools(token?: string, fetcher?: WebFetch): ToolDefinition[] {
  const client = new GitHubClient(token, fetcher);
  const common = { owner: Type.String(), repo: Type.String() };
  const get = async <T>(url: string, signal?: AbortSignal) => (await client.request<T>(url, signal)).data;
  const commit = async (base: string, ref: string | undefined, signal?: AbortSignal) => {
    const resolved = ref ?? (await get<Repo>(base, signal)).default_branch;
    return { ref: resolved, ...(await get<Commit>(`${base}/commits/${encodeURIComponent(resolved)}`, signal)) };
  };
  const tool = (
    name: string,
    description: string,
    parameters: ToolDefinition["parameters"],
    action: (args: Args, signal?: AbortSignal) => Promise<unknown>,
  ): ToolDefinition => ({
    name,
    label: name,
    description,
    parameters,
    async execute(_id, args, signal) {
      try {
        const result = await action(args as Args, signal);
        return { content: [{ type: "text", text: wrapUntrusted(name, JSON.stringify(result)) }], details: {} };
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof GitHubError ? error.message : "GitHub data could not be read.";
        return { content: [{ type: "text", text: wrapUntrusted(name, message) }], details: {}, isError: true };
      }
    },
  });
  return [
    tool(
      "github_repo",
      "Read GitHub repository metadata, languages and a README excerpt (8 KB). Public repositories need no token.",
      Type.Object(common),
      async (args, signal) => {
        const base = repoPath(args);
        const repo = await get<Repo>(base, signal);
        const languages = await get<Record<string, number>>(`${base}/languages`, signal);
        let readme: string | null = null;
        try {
          readme = decode(await get<Content>(`${base}/readme`, signal), MAX_README_BYTES, true);
        } catch (error) {
          if (!(error instanceof GitHubError && error.status === 404)) throw error;
        }
        return {
          description: repo.description,
          defaultBranch: repo.default_branch,
          topics: repo.topics ?? [],
          languages,
          stars: repo.stargazers_count,
          lastPush: repo.pushed_at,
          license: repo.license,
          readme,
        };
      },
    ),
    tool(
      "github_tree",
      "List repository files and sizes under an optional path/ref, capped at 500 entries.",
      Type.Object({ ...common, path: Type.Optional(Type.String()), ref: Type.Optional(Type.String()) }),
      async (args, signal) => {
        const base = repoPath(args);
        if (args.path) filePath(args.path);
        const resolved = await commit(base, args.ref, signal);
        const tree = await get<{ tree: { path: string; size?: number; type: string }[]; truncated: boolean }>(
          `${base}/git/trees/${encodeURIComponent(resolved.commit.tree.sha)}?recursive=1`,
          signal,
        );
        const files = tree.tree.filter(
          (entry) =>
            entry.type === "blob" && (!args.path || entry.path === args.path || entry.path.startsWith(`${args.path}/`)),
        );
        return {
          ref: resolved.ref,
          sha: resolved.sha,
          files: files.slice(0, 500).map(({ path, size }) => ({ path, size: size ?? 0 })),
          truncated: tree.truncated || files.length > 500,
        };
      },
    ),
    tool(
      "github_file",
      "Read one UTF-8 text file (64 KB maximum), with a permalink pinned to the commit SHA. Binary files are refused.",
      Type.Object({ ...common, path: Type.String(), ref: Type.Optional(Type.String()) }),
      async (args, signal) => {
        const base = repoPath(args);
        const path = filePath(args.path ?? "");
        const resolved = await commit(base, args.ref, signal);
        if (!/^[a-f0-9]{40}$/i.test(resolved.sha)) throw new GitHubError(502, "GitHub returned an invalid commit SHA.");
        const file = await get<Content>(`${base}/contents/${path}?ref=${encodeURIComponent(resolved.sha)}`, signal);
        return {
          path: args.path,
          ref: resolved.ref,
          sha: resolved.sha,
          permalink: `https://github.com/${args.owner}/${args.repo}/blob/${resolved.sha}/${path}`,
          content: decode(file, MAX_GITHUB_FILE_BYTES),
        };
      },
    ),
    tool(
      "github_commits",
      "Read up to 50 commits, optionally restricted to a repository path.",
      Type.Object({
        ...common,
        path: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      async (args, signal) => {
        const base = repoPath(args);
        if (args.path) filePath(args.path);
        const limit = Math.min(50, Math.max(1, args.limit ?? 20));
        const params = new URLSearchParams({ per_page: String(limit), ...(args.path ? { path: args.path } : {}) });
        const commits = await get<Commit[]>(`${base}/commits?${params}`, signal);
        return commits.slice(0, limit).map((entry) => ({
          sha: entry.sha,
          date: entry.commit.author.date,
          message: entry.commit.message.split(/\r?\n/)[0],
          author: entry.author?.login ?? null,
        }));
      },
    ),
    tool(
      "github_search_code",
      "Search code within one repository for paths and fragments. Requires a GitHub token; use github_tree/github_file otherwise.",
      Type.Object({ ...common, query: Type.String() }),
      async (args, signal) => {
        repoPath(args);
        if (!token)
          return {
            message:
              "GitHub code search requires a token. Add one in Settings → Integrations, or use github_tree and github_file for public repositories.",
          };
        // Reject qualifiers that could widen the search beyond the requested repository.
        if (!args.query?.trim() || /(?:^|\s)(?:repo|org|user):/i.test(args.query))
          throw new GitHubError(400, "Provide search terms without repo, org or user qualifiers.");
        const params = new URLSearchParams({ q: `${args.query} repo:${args.owner}/${args.repo}`, per_page: "50" });
        const { data } = await client.request<{ items: { path: string; text_matches?: { fragment: string }[] }[] }>(
          `https://api.github.com/search/code?${params}`,
          signal,
          true,
        );
        return data.items.slice(0, 50).map((item) => ({
          path: item.path,
          fragments: (item.text_matches ?? []).slice(0, 5).map((match) => match.fragment.slice(0, 2000)),
        }));
      },
    ),
  ];
}
