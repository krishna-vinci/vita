# Self-host Vita

This guide takes you from an empty install to a checked resume. Vita bundles Pi 1.1: you do **not** need to install Pi separately. Pi connects Vita to subscription accounts, API providers, and local models. Your Vita account and your model-provider login are separate.

## Docker

### Requirements

Use Docker Engine or Docker Desktop with Docker Compose v2, an internet connection for the first image download, and a model subscription, API key, or local model server. Docker includes Node 22, git, Tectonic 0.17.0, poppler, and a warm TeX cache. Port 4317 must be free.

### Download and start

Create a directory for the deployment; commands below run there:

```sh
mkdir vita && cd vita
curl -fsSL https://raw.githubusercontent.com/krishna-vinci/vita/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/krishna-vinci/vita/main/.env.example -o .env
chmod 600 .env
docker compose pull
docker compose up -d
docker compose logs vita
```

Compose uses `ghcr.io/krishna-vinci/vita:latest`. It creates writable `./vita-home` and `./pi-agent` bind mounts. A short-lived `vita-init` service sets the **directories'** ownership to uid/gid 1000; Vita itself runs without root. `PI_CODING_AGENT_DIR=/pi-agent` means OAuth refreshes persist directly to the mount. Never make this mount read-only.

To validate the release Compose without loading credentials: `docker compose --env-file /dev/null config --no-env-resolution --quiet` (recent Compose v2).

For a source build, clone the repository instead, copy `.env.example` to `.env`, uncomment `build: .` under `vita`, then run `docker compose build` and `docker compose up -d`. Both services use the same image name. Do not pull over a locally built image unless you intend to switch to the release.

### First run

1. Open **http://127.0.0.1:4317**. Create your first admin account in the setup screen.
2. Enter the **one-time setup code** from `docker compose logs vita`. Docker binds `0.0.0.0` internally, so it requires the code even though the published port is loopback-only. Restarting before setup changes the code. After setup, it is no longer needed.
3. Connect a model provider below, then choose models in Settings.
4. On the welcome screen, choose **Import an old resume** or **Answer a few questions**. Review proposed source changes before applying them. You can also write an outline and evidence under Me. Supply your name and contact details; the model never invents the resume header.
5. Under **Me → Base resumes**, generate your master resume. Review any questions or failed checks. Create a base for your career direction, then under **Jobs** paste a job description, review the tailored resume, and export its PDF when the checks pass.

### Connect a provider

Choose one of these methods. For an independent checker you need at least two available model IDs; they may belong to one provider, though a different provider gives a more independent review.

#### Subscription login

```sh
docker compose exec -it vita pnpm vita login
```

At the Pi prompt, type **`/login`**, choose your provider, and follow its browser or device flow. Pi's bundled quickstart says: “Choose a provider, then follow the prompts to use a subscription or store an API key.” Type **`/quit`** when finished. The menu shows which login methods your provider supports; not every subscription includes API/model access.

On a headless server, open the displayed link on another machine. If Pi asks, paste the final redirect URL or authorization code back into the terminal. Do not enter resume prompts here; this terminal is for provider setup. Credentials are stored privately in `pi-agent/auth.json`.

Restart Vita after signing in, then list available models:

```sh
docker compose restart vita
docker compose exec vita pnpm vita models --available
```

`vita models` lists all chat models known to Pi as `provider/model-id`; `[credentials]` marks available models. `--available` filters to those models. Availability means Pi can resolve credentials, not a paid test completion or a guarantee that an expired/revoked account still works.

#### API keys

Edit `.env`, uncomment the relevant key, and paste the value. For example use `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY`. The example lists Pi's full primary-key table plus provider-specific options. Some providers need extra settings: Azure needs its endpoint/resource, Cloudflare needs account/gateway IDs, and Bedrock or Vertex can use ambient cloud credentials.

Recreate Vita so it receives the changed environment:

```sh
docker compose up -d --force-recreate vita
docker compose exec vita pnpm vita models --available
```

Keys in your host shell alone are not forwarded to Compose. Pi supports stored credentials too; when several sources exist, its documented priority is a runtime override, stored `auth.json`, `models.json`, then environment/ambient credentials. If an old stored login is taking precedence over a new key, use `vita login` and `/logout` for that provider first.

#### Local models: Ollama

Pi's `models.md` gives this compatible-endpoint example. Save it as **`pi-agent/models.json`** (merge providers if this file already exists):

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [{ "id": "qwen2.5-coder:7b" }]
    }
  }
}
```

The dummy key makes the model available to Pi; Ollama ignores it. The listed model must be downloaded and support tool calls. Local inference avoids provider charges but needs sufficient RAM/VRAM, and smaller models can struggle with evidence checks.

**Inside Docker, localhost is the Vita container.** One concrete way to run Ollama beside it is to create `compose.local.yaml`:

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama-models:/root/.ollama
volumes:
  ollama-models:
```

Change `baseUrl` in `pi-agent/models.json` to **`http://ollama:11434/v1`**, then:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d
docker compose -f compose.yaml -f compose.local.yaml exec ollama ollama pull qwen2.5-coder:7b
docker compose restart vita
docker compose exec vita pnpm vita models --available
```

This CPU example keeps Ollama on the internal network. Configure GPU access separately if needed. Pull a second tool-capable model and add its exact ID to `models` for the checker; one model reused for both roles fails the independence check. Keep using both `-f` files for upgrades and shutdown of this deployment.

#### Local models: llama.cpp or another compatible endpoint

Pi's `llama-cpp.md` documents the router command (run on the model host):

```sh
llama-server \
  --models-dir ~/models \
  --no-models-autoload \
  --jinja \
  --host 127.0.0.1 \
  --port 8080 \
  -ngl 999 \
  -c 32768
```

Place GGUF models in `~/models`. With the router reachable from Pi, run `vita login`, then **`/login llama.cpp`**, enter the router URL, and use **`/llama`** to load models (required with `--no-models-autoload`). `/model` selects a loaded model in the Pi terminal. The documented connection variables are `LLAMA_BASE_URL` and optional `LLAMA_API_KEY`.

For Vita's SDK runtime, also declare the loaded model through the compatible-endpoint contract in `models.json`; terminal extension discovery is separate from Vita's model configuration:

```json
{
  "providers": {
    "llama-local": {
      "baseUrl": "http://127.0.0.1:8080/v1",
      "api": "openai-completions",
      "apiKey": "local",
      "models": [{ "id": "REPLACE_WITH_EXACT_LOADED_MODEL_ID" }]
    }
  }
}
```

Get the exact ID from `curl http://127.0.0.1:8080/v1/models`. For an authenticated server replace the dummy `apiKey` with `${LOCAL_MODEL_API_KEY}` and supply that variable to Vita. Another OpenAI-compatible server uses the same structure with its own base URL, model IDs, and key. Declare a second model for the checker.

The loopback URLs above work for native Vita on the model host. For Docker, use a reachable model service name on the same Docker network, or the host's reachable address. A host server listening only on `127.0.0.1` cannot accept connections from Vita's container. Docker Desktop provides `host.docker.internal`; Linux Compose can add `extra_hosts: ["host.docker.internal:host-gateway"]` under `vita`. Bind the model server to an interface reachable from Docker and restrict access to that interface. Use that hostname in **both** the Pi login URL and `models.json`, then restart Vita.

The Pi documentation shipped with your checkout is under `node_modules/.pnpm/node_modules/@earendil-works/pi-coding-agent/docs/`: `quickstart.md`, `providers.md`, `models.md`, `llama-cpp.md`, and `custom-provider.md`. These are the version-matched reference for credentials and custom protocols.

### Choose models per role

Open **Settings** and enter the exact `provider/model-id` values printed by `vita models --available`. Choose a default for the roles you do not override, a strong writer, and a **different provider/model for checker**. Pi's terminal `/model` choice does not set Vita's role assignments.

| Role | Purpose | Guidance |
| --- | --- | --- |
| analyst | Understand the job and requirements | Reliable structured output |
| writer | Draft and revise resumes and letters | Strong writing and reasoning |
| checker | Check each line against evidence | Independent provider/model; careful reasoning |
| ats-reviewer | Review job keyword coverage | Reliable review model |
| resume-editor | Apply requested resume edits | Follows small, precise edit instructions |
| source-editor | Propose outline/evidence edits | Preserves facts and source wording |
| interviewer | Prepare questions and supported stories | Clear reasoning and communication |
| template-adopter | Adapt uploaded LaTeX templates | Strong code and layout reasoning |
| researcher | Read repositories and propose evidence | Tool-capable model |
| onboarder | Import or interview to build your sources | Careful extraction and questions |

You can also edit your workspace's `config/models.yaml`:

```yaml
default: provider/model-id
roles:
  writer: provider/strong-model-id
  checker: other-provider/checker-model-id
```

Replace those illustrative IDs with your available models. Find each user's path with `docker compose exec vita pnpm vita users`. A fresh workspace starts with one default model and needs a checker override. Settings returns credential-backed choices at `GET /api/settings/models/available`, along with setup hints when none are connected; the frontend dropdown integration is a separate task.

### Data sent to providers and costs

Hosted model calls send the source context needed for the role: your profile/outline/evidence, selected claims, resume drafts, job descriptions, chats, review notes, and research results. Import sends extracted resume content; template adoption sends template content. Different role providers may each receive personal information. Choose providers whose retention and privacy terms you accept. Vita stores workspace files locally; local model endpoints receive the same prompts on your own infrastructure.

Subscription use is subject to the provider's limits. API keys incur that provider's token charges. Checking, ATS review, revisions, research, and interview preparation add calls beyond drafting. Start with one master and one job, review usage in the app, and set spending limits at your provider. Vita cannot enforce your provider's bill or promise a fixed per-resume price.

### Check setup with doctor

```sh
docker compose exec vita pnpm vita doctor
# After creating/accessing your account (replace admin with your username):
docker compose exec vita pnpm vita doctor /data/users/admin
```

Doctor prints **PASS**, **WARN**, or **FAIL**, with an action for each item, and exits 1 on any FAIL. It checks Node 22.19+ and SQLite, git, Tectonic and a cached sample compile, poppler, writable data, Pi credentials, every role assignment, checker independence, and anonymous GitHub connectivity. A missing workspace argument or GitHub outage is only a warning. It does not generate a resume or make a paid test model call. A provider availability check may refresh OAuth credentials or contact a configured model service.

## Native install with systemd

Requirements: Linux with systemd user services, **Node 22.19+** (22 LTS recommended), **pnpm 10.28.2**, git, **Tectonic 0.17.0**, and poppler. On Debian/Ubuntu: `sudo apt-get install git poppler-utils`. Install Tectonic from its [official 0.17.0 release](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0) and put it on PATH.

```sh
git clone https://github.com/krishna-vinci/vita.git
cd vita
corepack enable
pnpm install --frozen-lockfile --prefer-offline
cp .env.example .env
chmod 600 .env
export VITA_DATA_DIR="$HOME/vita-home"
pnpm vita setup
pnpm vita login
pnpm vita models --available
scripts/install-service.sh
pnpm vita doctor
```

The installer builds the web app, substitutes this checkout into `deploy/vita.service`, pins the current Node and pnpm executable paths and PATH, writes `~/.config/systemd/user/vita.service`, enables it, and restarts it. Data defaults to **`~/vita-home`**, independent of the checkout. Use an absolute `VITA_DATA_DIR` when changing it. The unit loads checkout `.env`; a `VITA_DATA_DIR` there overrides the installed default, so keep it consistent with your CLI export. A custom `PI_CODING_AGENT_DIR` belongs in both `.env` and your login shell. Otherwise native Pi uses `~/.pi/agent`.

```sh
systemctl --user status vita
journalctl --user -u vita -f
loginctl enable-linger "$USER"   # optional: keep running after logout
```

Open **http://127.0.0.1:4317** and follow the first-run steps above. The default loopback bind needs no setup code. A non-loopback `VITA_HOST` prints a code to the journal. The installer prints the URL and journal command.

For API keys, fill `.env` before installing/restarting the unit. CLI commands do not read `.env`; export the same key variables in the shell when using `models` or `doctor`. `EnvironmentFile` does not expand `$HOME` or `~`; use absolute paths. Restart after credential/config changes:

```sh
systemctl --user restart vita
pnpm vita users
pnpm vita doctor "$VITA_DATA_DIR/users/admin"
```

On macOS or without systemd, use the same dependencies, then `pnpm build:web` and `pnpm server` in the foreground. Export `VITA_DATA_DIR` and provider variables first. Root pnpm commands run in package directories, so always use absolute data/workspace paths.

## Reverse proxy and TLS

Keep the published port/bind on loopback when using a proxy on the same host. A minimal Caddyfile:

```caddyfile
vita.example.com {
    reverse_proxy 127.0.0.1:4317
}
```

Point DNS at the host and allow Caddy's TLS ports. In `.env` set:

```dotenv
VITA_PUBLIC_ORIGIN=https://vita.example.com
VITA_TRUST_PROXY=1
```

Recreate Docker Vita or restart the native service. Trust proxy headers only when your proxy controls direct access and overwrites forwarding headers. `VITA_PUBLIC_ORIGIN` configures Origin validation; it can contain comma-separated public URLs. A proxy container on the Compose network can target `vita:4317` instead.

For native first setup through a public hostname, set `VITA_HOST=0.0.0.0` behind a firewall and use the journal's setup code, or complete setup locally first. The initial loopback guard rejects foreign hostnames before an admin exists. After changing HTTP/TLS or proxy settings, sign in again so the cookie matches the new scheme.

## Accounts and users

The first account is an admin. In **Settings → Users**, the admin adds people, supplies temporary passwords, and manages disabled/admin status. Each person receives a workspace under `vita-home/users/<username>` and must change their temporary password. Model credentials are shared by the instance; GitHub tokens are per user. Account creation is closed after first setup; it is not public registration.

To recover a password without putting it in shell history (Bash example):

```bash
read -rsp 'New password: ' vita_password; echo
printf '%s\n' "$vita_password" | docker compose exec -T vita pnpm vita reset-password admin
unset vita_password
```

Native equivalent: pipe the value to `pnpm vita reset-password admin` with the same absolute `VITA_DATA_DIR` as the server. Use at least 8 characters (a longer unique password is preferable). The CLI revokes that account's sessions. `pnpm vita users` lists account workspace paths; set up/access the account once before running doctor on its workspace.

## GitHub research

Public repositories work out of the box through GitHub's REST API, without `gh` or MCP. Anonymous calls have lower rate limits. For private repositories or higher limits, add your optional token in **Settings → GitHub**; grant access only to repositories you want researched. Tokens are encrypted per user using `vita-home/secret.key`. Doctor's anonymous rate-limit request remains a warning even when you have a saved token.

## Backups

Stop Vita for a consistent copy, then back up **`vita-home`**, **`pi-agent`**, and **`.env`** privately. Native Pi defaults to `~/.pi/agent`, so back that up instead if you did not override it. Include `vita.db`, any SQLite sidecars, `secret.key`, workspace `.git` directories, sources, uploads, and generated outputs. Workspaces are git repositories, but git history alone does not back up accounts, credentials, or all cache/history files. Explicit or legacy workspaces outside `vita-home` need separate backups.

```sh
docker compose stop vita
tar -czf vita-backup.tgz vita-home pi-agent .env
docker compose start vita
```

Native: stop/start with `systemctl --user stop/start vita`, using your actual directories in the archive command. Restore while stopped and preserve writable permissions. The ownership helper handles mount roots, not recursively restored files. If necessary repair only the restored Vita directories to uid/gid 1000 before restarting Docker.

## Upgrades

Back up first. With the release image:

```sh
docker compose pull
docker compose up -d
docker compose exec vita pnpm vita doctor
```

Read release notes for configuration changes; refresh Compose/example environment deliberately without overwriting credentials. To pin a version or roll back the application image, set the **same** release tag under both `vita` and `vita-init`. Data/database rollback may require your matching backup.

Native/source builds: pull the desired release, run `pnpm install --frozen-lockfile --prefer-offline`, `pnpm vita setup`, and rerun `scripts/install-service.sh`. Rerunning pins the current Node/pnpm paths and rebuilds web. Keep the installed service's data path exported while doing this. Source Docker builds use `docker compose build && docker compose up -d`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No models with credentials | No Pi login/key, wrong agent directory, or server lacks shell key | Run `vita login` and `/login`, or add the documented key to `.env`; recreate/restart; check `vita models --available` with the same environment. |
| Checker equals writer | Both inherit the same default | Select a different available provider/model for checker in Settings or `config/models.yaml`; run doctor on the workspace. |
| Tectonic missing or cache cold | Native dependency missing, wrong OS user/cache, or cache masked by a mount | Install Tectonic 0.17.0; run `pnpm vita setup` as Vita's OS user (Docker: `docker compose exec vita pnpm vita setup`). |
| Port in use | Another service owns 4317 | Change the host port in Compose, e.g. `127.0.0.1:4318:4317`; native: set `VITA_PORT=4318` and restart. Update the proxy/URL. |
| Permission denied on mounts | Restored files have another owner or Pi mount is read-only | Check `vita-init` logs, make mounts writable, repair the dedicated directories/files to uid/gid 1000. Helper only changes mount roots. |
| 401 after a proxy change | Old cookie or forwarded scheme/host mismatch | Set trusted forwarding and `VITA_PUBLIC_ORIGIN`, recreate/restart, then clear the old site cookie and sign in again. A wrong write Origin may instead produce 403. |
| Expired OAuth token | Refresh failed, revoked login, or credentials were not persisted | Rerun `vita login` and `/login`; verify the writable `pi-agent` mount, then restart. |
| Local model not listed or cannot connect | Container localhost, wrong model ID, or model not loaded | Use a reachable endpoint in `models.json`, download/load the model, and match its exact ID; restart Vita. |
| Setup code rejected | Code belongs to an earlier start | Read the current log/journal and use its new code. |
| Native CLI sees different data/providers | Package cwd or service-only environment | Export absolute `VITA_DATA_DIR`/`PI_CODING_AGENT_DIR` and the same keys as the unit. |
| UI missing on native install | Web was not built | Run `pnpm build:web` or rerun the installer, then reload port 4317. |

## Uninstall

Docker: `docker compose down` removes the containers/network and retains bind-mounted data. Remove the deployment directory only when you intend to delete its workspaces, accounts, and credentials; keep a backup first. If you added Ollama, use both Compose files; its named model volume is retained unless explicitly removed.

Native:

```sh
systemctl --user disable --now vita
rm "$HOME/.config/systemd/user/vita.service"
systemctl --user daemon-reload
```

With a custom `XDG_CONFIG_HOME`, remove the unit there instead. Remove the application checkout if desired. `~/vita-home`, external workspaces, and Pi credentials remain until you explicitly delete them. Do not remove a shared Pi agent directory used by other tools.
