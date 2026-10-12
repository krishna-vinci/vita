# Task: M7-T1 Self-hosting that works first time, including Pi

You are the IMPLEMENTER in /home/krishna/vita-worktrees/m7-t1-selfhost on branch codex/m7-t1-selfhost. Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere.

## Goal
Someone who has never used Pi can install Vita (Docker or native), connect a model provider (subscription login, API key, or a local model), pick models per role, and generate a first resume, by following one guide and a few commands. The app helps them along: it checks its own setup and says exactly what to do next.

## Reference (read-only)
- Studium: `/home/krishna/learny/docs/SELF_HOSTING.md`, `docs/INSTALL.md`, `Dockerfile`, `compose.yaml`, `scripts/install-service.sh`, `deploy/studium.service`. Vita should match this level of completeness. Studium mounts a **writable** `./pi-agent:/pi-agent` with `PI_CODING_AGENT_DIR=/pi-agent` and signs in with `docker compose exec -it studium pnpm --filter @studium/server exec pi` then `/login`.
- Pi 1.1 docs in `node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/docs/` (`quickstart.md`, `providers.md`, `models.md`, `custom-provider.md`, `llama-cpp.md`, `environment-variables.md`, `containerization.md`). Use them for exact provider names, env key names, `/login` behaviour, `models.json` for custom/local providers (Ollama, llama.cpp, any OpenAI-compatible endpoint) and `PI_CODING_AGENT_DIR`. Do not invent flags; quote what the docs say.
- Vita: `Dockerfile` (currently copies a read-only `/pi-agent` into the home directory, so refreshed OAuth tokens are lost), `compose.yaml`, `.env.example`, `docs/INSTALL.md` (still says account screens come later; they exist now), `README.md`, `server/src/runtime.ts` (settings, providers), `core/src/agent/models.ts`, `cli/src/index.ts`.

## Deliverables
1. **Docker:**
   - Use a writable `./pi-agent:/pi-agent` volume with `PI_CODING_AGENT_DIR=/pi-agent` (remove the copy-into-home workaround).
   - Add a short-lived ownership helper service like Studium's, for fresh bind mounts (uid 1000), and keep `vita-home` the same way.
   - `docker compose exec -it vita pnpm vita login` must work (see CLI below).
   - Keep a non-root runtime and a healthcheck.
   - The compose file must work from a release image (`ghcr.io/krishna-vinci/vita:latest`), with `build: .` as an alternative, mirroring Studium's release compose.
2. **CLI:**
   - `vita login`: runs the bundled Pi CLI interactively (the `pi` binary from `@earendil-works/pi-coding-agent`), honouring `PI_CODING_AGENT_DIR`. It first prints a two-line hint: "Type /login, choose your provider, finish the browser or device step, then /quit."
   - `vita models [--available]`: lists the models Pi knows, as `provider/model-id`, marking the ones with credentials. Use `ModelRuntime` like `createGenerationRuntime`.
   - `vita doctor [dir]`: checks and prints PASS, WARN or FAIL with a fix line for each item. Exit 1 on any FAIL. The items:
     - Node 22 and `node:sqlite`;
     - git;
     - Tectonic on PATH, plus a warm cache (try `--only-cached` on the bundled sample; if it is cold, say "run `pnpm vita setup`");
     - `pdftotext` and `pdfinfo`;
     - the data dir is writable;
     - Pi agent dir resolved, with which providers have credentials;
     - the workspace `config/models.yaml` resolves every configured role to a known model with credentials, and the checker model differs from the writer;
     - GitHub research reachable (anonymous rate-limit call), as a WARN only.
   - `vita setup` stays as is.
3. **Server and settings:**
   - `GET /api/settings/models/available` returns the models with credentials, so the UI can show dropdowns instead of free text, plus a `setupHints` array (the same fix lines as doctor) shown in Settings when no provider is connected.
   - A frontend agent adds the dropdowns later. Keep the DTO in `shared/src/api.ts` (or `api-models.ts`).
4. **Native install:**
   - `deploy/vita.service` (systemd user unit template) and `scripts/install-service.sh`, like Studium's.
   - The script substitutes the checkout path, pins the current node/pnpm paths, sets `VITA_DATA_DIR` (default `~/vita-home`), builds the web app, enables and starts the unit, and prints the URL and the setup-code log command.
5. **Docs:**
   - **New `docs/SELF_HOSTING.md`,** the complete guide. Sections:
     - **Docker:**
       - requirements;
       - the `curl` compose and `.env` steps;
       - first run (setup code, admin account);
       - connecting a provider: subscriptions via `vita login` (`/login`), API keys via `.env`, and local models via Ollama or llama.cpp with a `models.json` example from Pi's docs;
       - choosing models per role, with a table of roles (analyst, writer, checker, ats-reviewer, resume-editor, source-editor, interviewer, template-adopter, researcher, onboarder) and plain guidance: a strong model for the writer, and a different provider/model for the checker;
       - what data goes to providers, and cost notes;
       - `vita doctor`.
     - **Native install** with systemd.
     - **Reverse proxy and TLS** (Caddy example; `VITA_TRUST_PROXY`, `VITA_PUBLIC_ORIGIN`).
     - **Accounts and users:** the admin adds people, password reset via the CLI.
     - **GitHub research:** public repos work out of the box; an optional token in Settings.
     - **Backups:** what to back up (`vita-home`, `pi-agent`, `.env`; workspaces are git repos).
     - **Upgrades.**
     - **Troubleshooting:** a table of symptom, cause and fix covering at least:
       - "No models with credentials";
       - a checker equal to the writer;
       - Tectonic missing or a cold cache;
       - a port in use;
       - permission denied on mounts;
       - 401 after a proxy change;
       - an expired OAuth token (rerun `vita login`).
     - **Uninstall.**
   - **`docs/INSTALL.md`:** shorten to a quick path that links SELF_HOSTING. Remove the outdated "screens supplied by a separate task" text and the curl-only setup flow; the UI exists now.
   - **`README.md`:** the quick start links SELF_HOSTING and shows `vita login` and `vita doctor`.
   - **`.env.example`:** list provider key names from Pi's docs (commented), `PI_CODING_AGENT_DIR` and the Vita variables.
6. **Tests:**
   - doctor checks with injected probes (no network);
   - `models --available` mapping with a faux runtime;
   - available-models route;
   - login spawns the expected binary with the inherited env (mock spawn);
   - the install script under `bash -n`;
   - compose validation via `docker compose config` in a test-safe way, or a documented manual check if Docker is unavailable in tests.

## Scope
- Change: `Dockerfile`, `compose.yaml`, `.env.example`, `deploy/**`, `scripts/install-service.sh`, `cli/src/**`, `server/src/**` (available-models route only), `shared/src/**` (DTO), `docs/SELF_HOSTING.md`, `docs/INSTALL.md`, `README.md`, tests.
- Do not touch: `web/`, engine logic.

## Tests
```
pnpm install --frozen-lockfile --prefer-offline
pnpm --filter @vita/cli exec vitest run
pnpm --filter @vita/server exec vitest run
pnpm --filter @vita/cli exec tsc --noEmit
pnpm --filter @vita/server exec tsc --noEmit
pnpm --filter @vita/shared exec tsc --noEmit
rtk proxy pnpm exec biome check cli server shared
bash -n scripts/install-service.sh
pnpm vita doctor   # on this host; report its output
```
If Docker is available: build the image, run with fresh `./vita-home` and `./pi-agent` dirs, confirm health and that `docker compose exec -it vita pnpm vita models` runs (it may list no credentials). Clean up containers and images afterwards.

If a step does not fit the real code, stop and report the mismatch (file:line, what you saw) — but first check whether AGENTS.md already allows the edit.
Follow AGENTS.md. Do not commit. End with the AGENTS.md final report.
