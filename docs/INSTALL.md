# Install and self-host Vita

Keep the accounts data directory separate from the application checkout. Each account owns a workspace with plain files and git history. The application requires a cookie session for workspace access; `/api/health` is public.

## Local development

Requirements: Node.js **22** with `node:sqlite` (22.13 or newer), pnpm **10.28.2**, git, **Tectonic 0.17.0**, and poppler's `pdftotext` and `pdfinfo`. On Debian/Ubuntu install poppler with `sudo apt-get install poppler-utils`. Install Tectonic from its [official release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0).

```sh
corepack enable
pnpm install --frozen-lockfile --prefer-offline
pnpm vita setup
export VITA_DATA_DIR="$PWD/vita-home"
pnpm server
```

In another terminal run `pnpm web`, then open `http://127.0.0.1:5173`. Vite proxies API requests to port 4317. For one server serving the built frontend, run `pnpm build:web` and use `http://127.0.0.1:4317`.

Root `pnpm vita` and `pnpm server` run in different package directories. Use an **absolute `VITA_DATA_DIR`** for both; otherwise each process resolves `./vita-home` from its own cwd. Local startup reads shell variables and does not automatically load `.env`.

After creating an account, access its workspace to initialize `users/<username>/`. Edit `profile.yaml`, `outline.md` and `projects.md`. Choose a default and distinct writer/checker models in `config/models.yaml` or Settings. An initialized workspace warns until you select a different checker.

`pnpm vita setup` warms bundled TeX packages using a trusted, network-enabled compile. Normal renders use `--only-cached`; warm the cache as the same OS user as the server. Never warm an unreviewed upload through the trusted path.

## First run and accounts

When the database has no accounts, workspace routes return `{ "setupRequired": true }`. `GET /api/auth/state` reports setup and sign-in state. Health, auth state, and the web shell/assets remain public so setup can load. The first account becomes an enabled admin and is signed in immediately.

A loopback bind (`127.0.0.1`, `::1`, or `localhost`) needs no setup code. Any other bind prints a random **one-time setup code** in the server log. Enter it when creating the first admin. A restart before setup generates a new code. Once an account exists, setup is closed and no code is printed. Docker binds `0.0.0.0` internally, so it requires the code even when its published port is loopback-only.

The setup, login and admin screens are supplied by the separate frontend task. The account API can be used directly in the meantime. For example, use fictional placeholders in this JSON and omit `setupCode` on a loopback bind:

```sh
curl --fail-with-body -c /tmp/vita-cookies -H 'Content-Type: application/json' \
  --data-binary @- http://127.0.0.1:4317/api/auth/setup <<'JSON'
{"username":"admin","displayName":"Administrator","password":"REPLACE_WITH_PRIVATE_PASSWORD","setupCode":"CODE_FROM_SERVER_LOG"}
JSON
curl --fail-with-body -b /tmp/vita-cookies http://127.0.0.1:4317/api/me
```

Treat the cookie file as private and remove it when finished. `POST /api/auth/login` accepts `username` and `password`; `POST /api/auth/logout` deletes the current session. Failed logins are limited per IP and username, returning 429 with `Retry-After` after five failures in fifteen minutes.

Admins manage accounts through `/api/admin/users`:

- `GET` lists users; `POST` accepts `username`, `displayName`, `password`, optional `isAdmin`, and optional absolute `workspace`.
- `PATCH /:username` changes `displayName`, `isAdmin`, or `disabled`.
- `POST /:username/password` sets a temporary `password` and revokes all that user's sessions.
- `DELETE /:username` deletes the account and sessions, retaining the workspace; the response reports its path. A retained default workspace prevents reuse of that username. Explicit workspace paths cannot overlap another account's workspace.

New users and admin password resets require the user to change their temporary password before accessing workspace routes. `POST /api/auth/password` accepts `currentPassword` and `newPassword`; it preserves the current session and revokes all others. The last enabled admin cannot be deleted, disabled or demoted.

Passwords use salted scrypt. Random session tokens are stored only as SHA-256 hashes, expire after thirty days of inactivity, and slide on authenticated requests. Cookies are HttpOnly, SameSite=Strict, and Secure for HTTPS requests. Jobs, SSE events, settings, uploads and source files stay within the signed-in user's workspace.

## Password recovery from the shell

Use the same absolute accounts directory as the server. The new password comes from stdin, never a command-line argument. Bash example:

```sh
export VITA_DATA_DIR="$PWD/vita-home"
pnpm vita users
read -r -s -p 'New password: ' VITA_NEW_PASSWORD; printf '\n'
printf '%s' "$VITA_NEW_PASSWORD" | pnpm --silent vita reset-password admin
unset VITA_NEW_PASSWORD
```

This clears the temporary-password flag and revokes **all** sessions for that account. Supply one password of 8–1024 characters, optionally ending in LF/CRLF. The CLI refuses to create a missing accounts database. `hash-password` remains a legacy scrypt utility; its output is no longer a server setting.

For Compose, use `docker compose exec vita pnpm vita users` and pipe the password to `docker compose exec -T vita pnpm --silent vita reset-password admin`.

## Migrating from VITA_PASSWORD_HASH

Back up the existing workspace and remove `VITA_PASSWORD_HASH` from your environment; the server ignores it. Set `VITA_DATA_DIR` to a new accounts directory and `VITA_WORKSPACE` to the **existing** workspace's absolute path before first setup:

```sh
export VITA_DATA_DIR="$PWD/vita-home"
export VITA_WORKSPACE="$PWD/vita-data"
pnpm server
```

Create the first admin with a new password. If the legacy directory contains `outline.md`, that admin's account records the path and uses it directly: no files are copied or moved, and git history stays in place. Other users use `VITA_DATA_DIR/users/<username>/`. Keep the accounts directory outside the legacy workspace so these paths do not overlap. The override is considered only during first setup; changing it later does not change accounts. If no outline exists there, the first admin gets a normal per-user workspace. Remove the override after setup if desired.

For an existing Docker workspace, mount the old directory at `/legacy-workspace`, use a new `/data` mount for accounts, and set `VITA_WORKSPACE=/legacy-workspace`. This changes the container mount location without moving or copying host files. Retain the legacy volume after setup because the admin still uses its path. A legacy workspace containing the accounts directory can continue as the first admin's workspace, but additional workspaces must be outside it: overlapping workspace paths are rejected to preserve user isolation.

## Docker Compose

Docker and Compose are the only host runtime requirements. The image includes git, poppler, checksum-verified Tectonic 0.17.0, and a warmed TeX cache.

```sh
cp .env.example .env
mkdir -p vita-home
# Linux bind mounts must be writable by UID/GID 1000:
sudo chown 1000:1000 vita-home
docker compose up -d --build
docker compose logs vita
curl --fail http://127.0.0.1:4317/api/health
```

Read the setup code from the log. No hash generation is needed. The entrypoint creates the accounts data directory; individual workspaces initialize lazily after setup and sign-in. Existing data is reused. The public healthcheck expects `{"ok":true}`, including before setup.

Compose mounts `./vita-home:/data`: `/data/vita.db` stores accounts and sessions, and `/data/users/<username>/` holds each normal workspace. Explicit paths must be available inside the container. The non-root runtime uses UID/GID 1000; arrange ownership/ACLs before mounting existing data. The image does not recursively change ownership. The pre-warmed TeX cache lives at `/home/vita/.cache`; do not hide it with an empty mount. `docker compose down` retains host data.

To upgrade, stop Vita, back up all data, update the checkout, and run `docker compose up -d --build`. Tagged releases publish amd64/arm64 GHCR images; the supplied Compose file builds locally.

## Pi credentials

**Provider keys:** uncomment `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `.env`, or export them for local startup. Other Pi-supported providers use their own variables. These instance credentials are available to generation in every user's runtime. Configure models independently in each workspace. Credentials never belong in workspace git.

**Pi OAuth/subscriptions:** sign in with Pi on the host, then uncomment this Compose volume:

```yaml
- ${HOME}/.pi/agent:/pi-agent:ro
```

UID 1000 must be able to read the mount. The entrypoint imports only `auth.json` and optional `models.json` into a private writable `/home/vita/.pi/agent` copy for locking, refresh and model caching. The host stays read-only. Container refreshes are ephemeral and are not synchronized back; reauthenticate on the host and recreate the container when needed. Treat copied credentials and container access as private.

No provider is needed to start the server or render an existing resume. Generation needs valid credentials and selected models; provider requests include the source/evidence context needed for the role.

## Server configuration

| Variable | Default / behavior |
| --- | --- |
| `VITA_DATA_DIR` | `./vita-home` from process cwd; Compose `/data`. Contains `vita.db`, `secret.key` (created when saving a token), and `users/`. |
| `VITA_WORKSPACE` | Optional legacy first-admin override when it contains `outline.md` at setup. |
| `VITA_HOST` | `127.0.0.1` locally; Docker `0.0.0.0`. Non-loopback first setup requires a logged code. |
| `VITA_PORT` | `4317`; update port mapping if changed. |
| `VITA_TRUST_PROXY` | Only `1` trusts forwarded protocol and client-IP headers. Default off. |
| `VITA_PUBLIC_ORIGIN` | Optional comma-separated public origins when a proxy rewrites Host. |
| `GITHUB_TOKEN` | Optional server-wide fallback for GitHub research when a user has no saved token. Public repositories work without it. |
| `VITA_INSTANCE_DIR` | Optional operator-controlled `instructions/*.md`; mount separately, preferably read-only. |

Models, rules, packs, templates, instructions and MCP configuration are workspace files; see [README configuration](../README.md#configuration). MCP is an optional advanced integration. MCP executables must be installed in the image; HTTP endpoints must be reachable. Give MCP credentials only the permissions needed for research.

GitHub research works for public repositories out of the box, without the `gh` CLI or an MCP server. For private repositories and higher rate limits, add a fine-grained, read-only GitHub token in **Settings → Integrations**. Select the repositories you want Vita to read and grant **Contents: read** and **Metadata: read**. Code search requires authentication; tree and file tools also work without a token on public repositories.

Tokens are stored per user using AES-256-GCM in `vita.db`, with the key in `VITA_DATA_DIR/secret.key` (0600). They are never saved in workspace files or returned by the settings API. Deleting a user's token restores anonymous research, or the server's `GITHUB_TOKEN` fallback if set. Fine-grained tokens may report an empty scopes list; GitHub's `/user` response provides account and scope metadata.

Power users can still configure read-only MCP servers in `config/mcp.json`, including Pi's `!command` secret resolution. For example, an optional MCP header can use `"Authorization": "!printf 'Bearer '; pass show integrations/github"` if that command and password store are available on the host. Built-in GitHub tools need neither command execution nor MCP setup.

## TLS and reverse proxies

Keep the published port on loopback and put a TLS reverse proxy in front for remote access. For Caddy on the host:

```caddyfile
resume.example.com {
  reverse_proxy 127.0.0.1:4317
}
```

Forward the original Host and set `VITA_TRUST_PROXY=1` only when clients cannot reach Vita except through your trusted proxy. The proxy must replace forwarded headers. This enables Secure cookies behind TLS and accurate client-IP limits. If the proxy rewrites Host, set `VITA_PUBLIC_ORIGIN=https://resume.example.com`. Keep `/api/events` streaming without buffering or short timeouts.

Before first setup on a loopback bind, Vita also requires a loopback Host to block DNS rebinding. Complete setup locally, or bind non-loopback and use the logged setup code when initially provisioning through a public hostname. After setup, accounts protect all workspace API routes and the write Origin check continues to apply.

## Backups and troubleshooting

Stop the server for a consistent backup. Copy the entire `VITA_DATA_DIR`, including `vita.db`, `secret.key` (needed to decrypt saved integration tokens), and any SQLite sidecar files, every workspace's `.git`, evidence and generated files. Back up **explicit/legacy workspace paths separately** if outside that directory. Back up `.env` and host Pi credentials privately. `.vita/` is disposable cache except for job history needed if you want past jobs visible. Restore while stopped with matching permissions.

- Lost admin password: use `vita reset-password <username>` against the correct accounts directory.
- Setup asks for a code: inspect the current startup log; Docker always uses the non-loopback setup rule.
- 429 during sign-in: wait the reported `Retry-After` interval.
- Secure cookie missing behind TLS: verify `VITA_TRUST_PROXY=1`, header forwarding and direct-access restrictions.
- Permission denied: check data and Pi mount ownership for UID 1000.
- Missing TeX file: warm trusted bundled templates without masking the cache.
- Generation/model issues: check credentials and each workspace's `config/models.yaml`.
- Local server has no UI: build web or run Vite; account screens land in the separate web task.
