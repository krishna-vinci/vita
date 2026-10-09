# Vita architecture

Vita is a pnpm/TypeScript/ESM workspace. The [design spec](specs/2026-10-09-vita-design.md) describes the domain and binding principles; [§15](specs/2026-10-09-vita-design.md#15-architecture) and [§17](specs/2026-10-09-vita-design.md#17-security-and-privacy) cover deployment and security. Locked decisions in `docs/decisions/`, when added, override the spec.

| Package / directory | Responsibility |
| --- | --- |
| `shared/` | Zod schemas/types for resumes, claims, packs, templates, reviews and API DTOs. |
| `core/` | Workspace IO/git, source parsing/import, SQLite FTS5 evidence search, claims/lint, resume operations, fit-to-page, LaTeX/PDF checks, packs/templates, Pi roles and pipelines. No HTTP server. |
| `server/` | Hono API, Basic auth/origin checks, uploads/settings, in-process job runner, SSE and built web serving. |
| `web/` | React/Vite/Tailwind and TanStack Query UI: Me, Jobs, Settings, resume workspace. API requests and SSE keep views current. |
| `cli/` | Headless init/import/setup/master/tailor/render/check; `hash-password` reuses the server's scrypt helper. |
| `skills/`, `packs/`, `templates/` | Bundled role guidance, profession data and deterministic LaTeX contracts. Workspace overrides take priority where supported. |
| `fixtures/` | Fictional developer, nurse, teacher and accountant workspaces for neutrality and render tests. |

## Request and job flow

The browser sends a typed request to Hono. Authentication, origin/size checks and Zod validation run before workspace operations. Direct edits check file hashes for stale writes, apply operations under locks, commit accepted changes in the workspace, and publish resource events.

Long operations return a job with HTTP 202. The in-process runner invokes `core` generation under workspace coordination. Progress, usage and resource changes reach the browser through `/api/events` SSE; job metadata is cached under `.vita/jobs/`. The CLI calls the same engine directly and prints reviews rather than using HTTP.

Job generation analyses requirements, selects claims deterministically, drafts, lints, independently checks, reviews ATS coverage, compiles/extracts PDF text and performs bounded revisions. Export depends on the final review gate. The writer and checker must resolve to different models; checker fallback cannot use the writer model. Each role gets a fresh Pi session with scoped tools and validated submissions; only `core/src/agent/` imports Pi.

## Data and extension boundaries

An owner-controlled workspace has `profile.yaml`, `outline.md`, `projects.md`, `resumes/master/`, bases under `resumes/<id>/`, jobs under `applications/<id>/`, and `config/`, `packs/`, `templates/` and optional instructions/skills. Profile/header data is not model-written. Source claims anchor resume lines to evidence. Locked user bullets survive regeneration; source edits, promotion and downstream synchronization use approval proposals. `.vita/` is disposable cache, outside workspace git commits.

Models use `config/models.yaml`; credentials come from Pi's agent directory or provider env keys. Rules and packs are data, so the engine carries no profession vocabulary. Instructions are layered under invariant guards. Research MCP and web sources are explicitly scoped, and fetched content remains untrusted. Templates use Nunjucks with LaTeX-safe delimiters; pre-scan and Tectonic enforce a confined offline render path, then poppler checks extracted text and pages.

## Runtime packaging

Docker builds the SPA, installs production CLI/server dependencies, and ships Node 22, git, poppler and checksum-verified Tectonic 0.17.0. Trusted bundled templates warm the TeX cache as the runtime `vita` user. The entrypoint initializes an empty mounted workspace and optionally imports read-only host Pi credentials into a private writable copy. The server is single-user, binds internally to `0.0.0.0`, requires a scrypt hash, and is published on loopback by Compose. Remote access uses TLS at a reverse proxy. See [INSTALL](INSTALL.md).
