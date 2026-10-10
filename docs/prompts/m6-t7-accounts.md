# Task: M6-T7 Accounts, sessions and per-user workspaces (like Studium)

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m6-t7-accounts on branch codex/m6-t7-accounts. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Goal
Replace HTTP Basic auth with real accounts the way Studium does it: an accounts database, cookie sessions, a first-run setup flow, an admin who adds and manages users, and one workspace per user. The browser never shows a native password prompt again.

## Reference (read-only) — Studium at /home/krishna/learny
- `server/src/accounts/{users,sessions,bootstrap,settings,tokens}.ts` (+ tests)
- `server/src/auth/{password,middleware,routes,reset-password-cli,hash-cli}.ts` (+ tests)
- `server/src/db/{db,migrations,crypto,secret}.ts` (node:sqlite)
- `server/src/workspaces/{manager,migrate-legacy}.ts` (one runtime per user)
- `server/src/main.ts:40-140` (bootstrap, setup code printed only for non-loopback, trustProxy/baseUrl)
- `server/src/server.ts` (guard, `/api/auth`, `/api/me`, `/api/admin`, per-user delegate)
Adapt; skip SSO, personal access tokens, AI gating and Studium-specific features.

## Requirements
1. **Data layout:**
   - `VITA_DATA_DIR` (default `./vita-home`) holds `vita.db` (SQLite: users, sessions, settings, migrations).
   - Per-user workspaces live in `users/<username>/` unless an account has an explicit `workspace` path.
   - `VITA_WORKSPACE` keeps working for legacy single-user installs: on first setup, if it is set and contains `outline.md`, the first admin's workspace points at it (no copy, no move). This is migrate-legacy.
2. **Accounts:**
   - Username (slug), display name, scrypt password (reuse `server/src/auth/password.ts`), `is_admin`, `disabled`, created/updated, workspace path.
   - Admins can create users (with a temporary password and must-change flag), reset passwords, disable/enable, make admin, and delete accounts (the workspace stays on disk; report its path).
   - The last admin cannot be removed or demoted.
3. **Sessions:**
   - Random 32-byte tokens stored hashed (sha256).
   - Cookie `vita_session`: HttpOnly, SameSite=Strict, Path=/, Secure when the request is https (honour `X-Forwarded-Proto` only when `VITA_TRUST_PROXY=1`).
   - 30-day sliding expiry; logout deletes the session.
   - Changing a password revokes the user's other sessions.
4. **First run:**
   - When no account exists, every route except setup returns `{ setupRequired: true }`.
   - On a non-loopback bind, `POST /api/auth/setup` requires a one-time setup code printed to the server log at startup. On loopback no code is needed (Studium rule).
   - Setup creates the first admin and signs them in.
5. **Login protection:**
   - Rate limit failed logins per IP and per username (e.g. 5 per 15 minutes, then 429 with Retry-After).
   - Constant-time comparison; generic error text.
6. **Routes:**
   - `GET /api/auth/state` → `{ setupRequired, setupCodeRequired, user | null }`
   - `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password` (change own; requires the current password)
   - `GET /api/me`
   - Admin only: `GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:username`, `POST /api/admin/users/:username/password`
   - All existing `/api/*` routes now require a session and run against that user's workspace runtime (the Studium manager pattern: lazily create one `WorkspaceRuntime` per user, close idle ones, and keep jobs and SSE per user). `/api/health` stays public.
7. **Origin/CSRF:**
   - Keep the existing host-based Origin check and `VITA_PUBLIC_ORIGIN` for writes.
   - Keep the loopback Host guard only before setup.
   - Remove HTTP Basic auth and `VITA_PASSWORD_HASH` from the server.
   - The non-loopback bind is now allowed because accounts are always required.
8. **CLI:**
   - `vita reset-password <username>` reads the new password from stdin and writes to `VITA_DATA_DIR/vita.db`.
   - `vita users` lists accounts.
   - Keep `hash-password` working but mark it legacy in its help.
9. **Docs:** update `README.md` (env vars, first run), `docs/INSTALL.md` (setup code, users, reset-password, migrating from `VITA_PASSWORD_HASH`), `.env.example` and `compose.yaml` (`VITA_DATA_DIR=/data`, `/data/users/...`).
10. **Tests:**
    - setup with and without a code;
    - login success, failure and rate limit;
    - cookie flags;
    - session expiry and logout;
    - admin CRUD and the last-admin guard;
    - user isolation (user A cannot read user B's workspace through any route);
    - legacy `VITA_WORKSPACE` migration;
    - SSE scoped per user.

## Scope
- Change: `server/src/**` (new `accounts/`, `db/`, `workspaces/`; auth rewrite), `cli/src/**` (reset-password, users), `shared/src/api-auth.ts` (+ index export), docs listed above, `.env.example`, `compose.yaml`, tests.
- Do not touch: `web/` (a frontend agent builds the login, setup and admin screens next), engine logic in `core/` (only workspace-handle plumbing if strictly needed — list it).
- Other M6 tasks run in parallel and touch `server/src/server.ts` route registrations. Keep your route registration changes contained so merges stay simple: move existing registrations into a per-user sub-app rather than rewriting them.

## Tests
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/cli exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check server cli shared
```

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
