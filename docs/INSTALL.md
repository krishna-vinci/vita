# Install and self-host Vita

Vita is a single-user app. Keep the workspace separate from the application checkout. The [security guide](../SECURITY.md) and [design spec](specs/2026-10-09-vita-design.md#17-security-and-privacy) describe the trust boundaries.

## Local development

Requirements: Node.js **22**, pnpm **10.28.2** (root `packageManager`), git, **Tectonic 0.17.0**, and poppler's `pdftotext` and `pdfinfo`. On Debian/Ubuntu install poppler with `sudo apt-get install poppler-utils`. Put Tectonic on `PATH` from the [official release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0); the Dockerfile pins SHA-256 values for its Linux musl amd64/arm64 archives. For other platforms use the matching upstream binary.

```sh
corepack enable
pnpm install --frozen-lockfile --prefer-offline
tectonic --version
pdftotext -v
pdfinfo -v
pnpm vita setup
pnpm vita init "$PWD/vita-data" --name 'Your Name'
VITA_WORKSPACE="$PWD/vita-data" pnpm server
```

In another terminal run `pnpm web`, then open `http://127.0.0.1:5173`. Vite proxies the API to port 4317. For one server serving the built frontend, run `pnpm build:web` and use `http://127.0.0.1:4317`.

Root `pnpm vita` and `pnpm server` run in their package directories. Always pass an absolute workspace path. The server's implicit `./vita-data` is relative to `server/`. Shell environment variables are read directly; `.env` is **not** automatically loaded by local startup.

Edit the workspace's `profile.yaml` (name, headline, contact), `outline.md` and `projects.md`. Choose a default and distinct writer/checker models in `config/models.yaml` or Settings. An initialized workspace defaults to one model for every role and warns until you select a different checker. Available model identifiers depend on Pi's provider catalogue and your account. Base generation uses the writer role.

`pnpm vita setup` is a trusted, network-enabled compile of bundled templates. Normal renders use `--only-cached`; run setup as the same OS user/cache environment as the server. New template packages also need a trusted cache warm-up; never use the trusted warm-up path for an unreviewed upload.

## Generate a password hash

The server reuses this scrypt format for HTTP Basic auth. The CLI reads stdin, strips a single final LF/CRLF, preserves spaces and rejects empty or multiline input. In Bash:

```sh
read -r -s -p 'Vita password: ' VITA_PASSWORD; printf '\n'
printf '%s' "$VITA_PASSWORD" | pnpm --silent vita hash-password
unset VITA_PASSWORD
```

Copy only the `scrypt$16384$8$1$…` output. For Compose, set `VITA_PASSWORD_HASH='scrypt$…'` in `.env`: **single quotes are necessary** to avoid interpolation of the literal dollar signs. Keep `.env` private and out of git.

For a local server, export the hash using single quotes, then start it:

```sh
export VITA_PASSWORD_HASH='REPLACE_WITH_SCRYPT_HASH'
VITA_WORKSPACE="$PWD/vita-data" pnpm server
```

Use username `vita` and your password in the browser. The server validates the password; it does not distinguish usernames. Changing the environment hash and restarting rotates the password. No plaintext password is stored by Vita.

## Docker Compose

Docker and Compose are the only host runtime requirements. The multi-stage image builds the web app, includes git, poppler and checksum-verified Tectonic 0.17.0, and warms bundled template packages as the non-root runtime user.

```sh
cp .env.example .env
mkdir -p vita-data
# Linux bind mounts must be writable by UID/GID 1000:
sudo chown 1000:1000 vita-data
docker compose build
```

For an existing data directory, arrange ownership/ACLs for all files Vita must update; preserve a backup first. The image does not recursively change ownership. Docker Desktop usually handles host bind permissions itself.

Generate a hash without installing Node/pnpm on the host (Bash):

```sh
read -r -s -p 'Vita password: ' VITA_PASSWORD; printf '\n'
printf '%s' "$VITA_PASSWORD" | docker run --rm -i --entrypoint pnpm vita:local --silent vita hash-password
unset VITA_PASSWORD
```

Set the single-quoted hash in `.env`, add provider credentials as described below, then:

```sh
docker compose up -d
docker compose logs -f vita
curl -u vita http://127.0.0.1:4317/api/health
```

`curl` prompts for your password and returns `{"ok":true}`. The image binds `0.0.0.0` inside the container and requires `VITA_PASSWORD_HASH`, even though Compose publishes only `127.0.0.1:4317`. The image healthcheck expects the authenticated endpoint's `401 unauthorized` response without a password; this tests route/auth availability. Use the authenticated curl above to confirm its successful health response.

The entrypoint initializes an **empty** `/data`. A non-empty directory without `outline.md` is rejected to avoid overwriting partial/restored data. An existing workspace is reused. Set your profile name before generation; initial `My workspace` is a placeholder.

All workspace files and their git history live in `./vita-data:/data`. The pre-warmed TeX cache lives in `/home/vita/.cache`; do not hide it with an empty mount. App source remains root-owned; the `vita` user (1000:1000) owns data and caches. `docker compose down` removes containers, not the host workspace.

To upgrade, stop Vita, back up `vita-data`, update the checkout, and run `docker compose up -d --build`. Tagged CI releases publish `ghcr.io/<owner>/<repo>:<version>` for amd64/arm64; after publication you can replace Compose's local image/build with that image and pull it. The supplied Compose file builds locally and does not depend on a published image.

## Pi credentials: two options

**Provider environment keys:** uncomment and replace `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` in `.env`; Compose passes them to the container. Other Pi-supported providers may use their own env keys. Locally export keys in the shell that starts the server. Configure matching model identifiers in the workspace. Provider keys and the password hash never belong in the workspace git repo.

**Pi OAuth/subscription logins:** sign in with Pi on the host so `~/.pi/agent/auth.json` exists. Uncomment this volume under `vita.volumes` in `compose.yaml`:

```yaml
- ${HOME}/.pi/agent:/pi-agent:ro
```

The host directory and files must be readable by container UID 1000. The entrypoint imports only `auth.json` and optional `models.json` into a private writable `/home/vita/.pi/agent` copy. Pi needs writes for credential locking/refresh and its model cache; the host mount stays read-only. Refreshes in the container are ephemeral and are not synchronized back: sign in on the host again if tokens expire or a restarted container has stale credentials. Recreate the container after changing host credentials. Do not mount the source at Pi's writable internal directory. Treat the copied credentials and container access as private, too.

No provider is required to start the UI or render an existing resume; generation requires valid credentials and selected models. Provider calls send the source/evidence context needed for the requested role.

## Server configuration

| Variable | Default / behavior |
| --- | --- |
| `VITA_WORKSPACE` | Local `./vita-data` from server cwd; Docker `/data`. |
| `VITA_HOST` | Local `127.0.0.1`; Docker `0.0.0.0`, requiring a hash. |
| `VITA_PORT` | `4317`; if overridden, update Compose's port mapping. |
| `VITA_PASSWORD_HASH` | Optional on loopback; required otherwise. Scrypt only. |
| `VITA_INSTANCE_DIR` | Optional operator-controlled directory containing `instructions/*.md`. Mount it separately in Docker (prefer read-only). |

Model overrides, rules, packs, templates, instructions and MCP configuration are workspace files; see [README configuration](../README.md#configuration). MCP stdio executables must be installed in the runtime image; HTTP MCP endpoints must be reachable from the container. Declare research URLs/servers through instructions, and give MCP tokens only read permissions.

## Expose safely

Keep the published port on loopback. For remote use, put a reverse proxy with TLS in front of it and keep the password enabled. A Caddy proxy on the host can use:

```caddyfile
resume.example.com {
  reverse_proxy 127.0.0.1:4317
}
```

Replace the hostname, configure DNS, and let your proxy manage the certificate. Forward the `Authorization` header and the original `Host` header (Caddy and nginx `proxy_set_header Host $host` do this). If your proxy rewrites `Host`, set `VITA_PUBLIC_ORIGIN=https://vita.example.org` (comma-separated for several) so browser writes from that origin are accepted. Test saving from the browser. Keep SSE `/api/events` streaming without response buffering or short timeouts. A proxy container on the Compose network can reach `vita:4317`.

HTTP Basic auth carries reusable credentials on each request. Use HTTPS for remote access and firewall direct access to port 4317. A trusted personal VPN or SSH tunnel to the loopback service is also suitable. Vita is not a multi-tenant service: anyone with the password can access this workspace and trigger provider usage.

## Backups and troubleshooting

Stop the container/server for a consistent backup, then copy the entire workspace including `.git`, evidence uploads and generated files. Back up `.env` and host Pi credentials separately with private permissions. `.vita/` is disposable cache. Restore into a writable directory with the same ownership requirements; do not restore over a running instance.

- Refuses startup: replace the placeholder password hash; check quoting and `VITA_HOST`.
- Permission denied: check data ownership and Pi mount readability for UID 1000.
- Missing TeX file during render: warm trusted bundled templates as the same user, without masking the pre-warmed cache.
- No generation / wrong model: check provider login/key and `config/models.yaml`; the checker must differ from the writer.
- Local server has no UI: run `pnpm build:web`, or use Vite on port 5173.
- Data directory has files but no outline: initialize a new empty directory explicitly, or restore a complete workspace. The container does not repair it automatically.
