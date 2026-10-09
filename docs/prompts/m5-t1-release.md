# Task: M5-T1 Release packaging, CI and docs

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m5-t1-release on branch codex/m5-t1-release. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work.

## Goal
Make Vita installable and contributable as an open-source project: a Docker image with Tectonic and poppler and a pre-warmed TeX cache, a Compose file, GitHub Actions CI and a release workflow, a full README and install/self-hosting/contribution docs, and removal of personal absolute paths from tracked files. Do not publish or push anything.

## Context
- Read first: `AGENTS.md`, `AGENT_MEMORY.md`, spec `docs/specs/2026-10-09-vita-design.md` (§15 deployment, §17 security), `NOTICE`, `README.md`, root `package.json`, `server/src/main.ts` (env: `VITA_WORKSPACE`, `VITA_HOST`, `VITA_PORT` 4317, `VITA_PASSWORD_HASH`, `VITA_INSTANCE_DIR`), `server/src/auth/password.ts` (how to make a hash), `cli/src/index.ts` (`vita init/import/setup/render/check/master/tailor`), `core/src/render/warm.ts`.
- Reference (read-only): Studium `/home/krishna/learny/Dockerfile`, `compose.yaml`, `.github/workflows/{ci,release}.yml`, `docs/INSTALL.md`, `CONTRIBUTING.md`, `SECURITY.md`.
- Pi model credentials: Pi reads `~/.pi/agent/auth.json` (OAuth/subscription logins) or provider env keys such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. In Docker, mount the user's Pi agent dir read-only or pass env keys. Document both.
- Tectonic 0.17.0 release asset: `tectonic-0.17.0-<arch>-unknown-linux-musl.tar.gz` from `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/` (x86_64 and aarch64). Verify the download with a pinned SHA-256 in the Dockerfile; compute the amd64 hash locally (`sha256sum` after downloading to a temp dir) and for arm64 do the same; if you cannot download in this environment, leave a clearly named `ARG TECTONIC_SHA256_<ARCH>` with a build-time check and say so in the report.
- A Sonnet agent is editing `web/` in the main tree. Never touch `web/` source (the Dockerfile builds it).

## Deliverables
1. `Dockerfile` (multi-stage like Studium's): build stage installs the workspace and builds the web app; runtime stage `node:22-slim`, installs `poppler-utils`, `git`, Tectonic (pinned, checksum-verified), copies the app, runs `vita setup` at build time to warm the TeX cache for bundled templates, runs as a non-root `vita` user, `EXPOSE 4317`, `ENV VITA_HOST=0.0.0.0 VITA_WORKSPACE=/data`, healthcheck on `/api/health`, entrypoint starts the server. Because the container binds 0.0.0.0, startup requires `VITA_PASSWORD_HASH` (existing rule) — document the hash command.
2. `.dockerignore`.
3. `compose.yaml`: one service, `./vita-data:/data` volume, port `127.0.0.1:4317:4317`, env file `.env` (example in `.env.example` with only placeholders), optional read-only mount of `~/.pi/agent`.
4. A CLI command or script to make a password hash: `pnpm vita hash-password` (reads from stdin, prints the scrypt hash; reuse `server/src/auth/password.ts`) — integration edit, list it.
5. `.github/workflows/ci.yml`: install, `biome check .`, `tsc --noEmit` for every package, full vitest suites per package (CI may run full suites), install Tectonic (same pinned release) + `poppler-utils` so render tests run, `pnpm build:web`.
6. `.github/workflows/release.yml`: on `v*` tags build and push a multi-arch (amd64, arm64) image to GHCR with provenance and SBOM; no secrets other than `GITHUB_TOKEN`.
7. Docs:
   - `README.md` — what Vita is (one paragraph), the principles in brief, screenshots placeholder section listing which screenshots will go there (no images yet), quick start (Docker and local dev), how it works (outline → master → base → job; honesty checks), configuration (models per role, Pi credentials, MCP, instructions, rules, packs, templates), CLI reference, project status, licence and Rover attribution.
   - `docs/INSTALL.md` — local dev (Node 22, pnpm, Tectonic, poppler, `pnpm vita setup`), Docker, password hash, exposing safely (loopback by default; reverse proxy with TLS).
   - `CONTRIBUTING.md` — dev workflow, AGENTS.md testing policy summary, how to add a profession pack (format, synonyms rules, neutrality test), how to add or adopt a template (contract delimiters `((( )))`, `((* *))`, knobs, attribution), skills.
   - `SECURITY.md` — reporting, threat model summary (untrusted job posts and pages, LaTeX sandbox, file confinement, auth).
   - `docs/ARCHITECTURE.md` — short package map and request/job flow, linking the spec.
8. Path scrub: replace `/home/krishna/...` absolute paths in tracked files (`AGENTS.md`, `AGENT_MEMORY.md`, `.claude/skills/codex-orchestrate/SKILL.md`, docs, prompts, plans) with repo-relative paths or `<repo>` / `<studium-checkout>` placeholders, keeping meaning. Do not change `.claude/codex-runs` (gitignored). Report every file changed by the scrub.
9. Secret scan: run `git log -p | grep -E "(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN (RSA|OPENSSH) PRIVATE KEY)"` and `grep -rE` the same over tracked files; report results (expected: none).

## Scope
- Change: the files above, root `package.json` scripts, `cli/src/**` (hash-password only), `.claude/skills/codex-orchestrate/SKILL.md` (paths only), `AGENTS.md` and `AGENT_MEMORY.md` (paths only), `docs/**` (paths only, plus the new docs).
- Do not touch: `web/src`, engine logic.

## Tests
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/cli exec tsc --noEmit
rtk proxy pnpm exec biome check .
docker build -t vita:dev .        # if Docker is available and the build can run here; report time and image size
```
If `docker build` works, also run the container with a generated password hash and a temp volume, and confirm `curl -u vita:<password> http://127.0.0.1:4317/api/health` returns ok; stop and remove the container and image afterwards.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) instead of improvising — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
