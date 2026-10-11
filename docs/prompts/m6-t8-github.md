# Task: M6-T8 GitHub research that works for every host

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m6-t8-github on branch codex/m6-t8-github. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Goal
Research from GitHub must work on any Vita install without the `gh` CLI or MCP setup. Public repositories work with zero configuration; a user can add their own GitHub token for private repositories and higher rate limits. The existing MCP path stays as an advanced option.

## Requirements
1. **Built-in read-only GitHub tools for the researcher** (`core/src/research/github.ts`), using the GitHub REST API with `fetch` (no new dependencies):
   - `github_repo(owner, repo)` → description, default branch, topics, languages, stars, last push, license, README excerpt (≤ 8 KB).
   - `github_tree(owner, repo, path?, ref?)` → file list (paths, sizes), capped at 500 entries.
   - `github_file(owner, repo, path, ref?)` → text content (≤ 64 KB; binary refused), with `ref` and a permalink at the commit SHA.
   - `github_commits(owner, repo, path?, limit?)` → sha, date, message first line, author login (≤ 50).
   - `github_search_code(owner, repo, query)` → paths and fragments; only when a token is present (code search requires auth), otherwise a clear tool message.
   - Requests go only to `api.github.com` and `raw.githubusercontent.com`.
   - Headers: `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: vita`, and `Authorization: Bearer <token>` only when a token exists.
   - Handle 404 (private repo or wrong name: suggest adding a token), 403/429 rate limit (report the reset time), and timeouts (15 s).
   - All returned text is wrapped as untrusted data.
   - Tools are registered for the researcher role, alongside `web_fetch` and any MCP servers. The researcher prompt prefers these built-in tools for GitHub URLs. Codemode can call them too (they are normal custom tools).
2. **Per-user token storage** (server):
   - Encrypted secrets table in `vita.db`: user, name, ciphertext, iv, tag, updated.
   - AES-256-GCM with a key in `VITA_DATA_DIR/secret.key`, generated on first use (0600). Reference: Studium `/home/krishna/learny/server/src/db/{crypto,secret}.ts`.
   - Routes:
     - `GET /api/settings/github` → `{ connected: boolean, login?: string, scopes?: string[], rateLimit?: { remaining, reset } }`, where `login` and `scopes` come from `GET https://api.github.com/user` when connected. Never return the token.
     - `PUT /api/settings/github` `{ token }` validates the token against `/user` before saving.
     - `DELETE /api/settings/github`.
   - The workspace runtime passes the user's token into research deps. Server-wide fallback: the `GITHUB_TOKEN` env var when the user has none.
3. **Researcher behaviour:** for a GitHub URL target (`github.com/<owner>/<repo>`) use the built-in tools. Use MCP only if configured. The existing read-only MCP policy stays.
4. **Docs:**
   - README configuration table and `docs/INSTALL.md`: GitHub research works for public repos out of the box. Add a fine-grained, read-only token in Settings → Integrations for private repos (Contents: read, Metadata: read). MCP is optional and advanced.
   - Remove any instruction that requires the `gh` CLI. Keep the `!command` MCP example as an optional power-user note.
5. **Tests** (no network; inject a fake `fetch`): each tool's mapping and caps; 404, 403-rate-limit and timeout messages; Authorization header present only with a token; host allow-list; secret round-trip encryption and that the API never returns the token; researcher faux run that uses `github_file` and produces a proposal.

## Scope
- Change: `core/src/research/**`, `core/src/agent/**` (registration if needed), `server/src/**` (secrets, settings route, runtime plumbing), `shared/src/api-github.ts` (+ index export), README.md and docs/INSTALL.md (sections named above), tests.
- Do not touch: `web/` (a frontend agent adds the Settings → Integrations UI).

## Tests
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/core exec vitest run src/research src/agent
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/core exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check core/src server/src shared/src
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
