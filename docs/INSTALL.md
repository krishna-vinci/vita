# Install Vita

Follow [SELF_HOSTING.md](SELF_HOSTING.md) for the complete Docker/native guide, Pi subscription/API/local provider setup, model roles, TLS, accounts, backups, upgrades, and troubleshooting. Pi is bundled; no separate install is needed.

## Docker quick path

```sh
mkdir vita && cd vita
curl -fsSL https://raw.githubusercontent.com/krishna-vinci/vita/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/krishna-vinci/vita/main/.env.example -o .env
chmod 600 .env
docker compose up -d
docker compose logs vita
docker compose exec -it vita pnpm vita login  # type /login, then /quit
docker compose restart vita
docker compose exec vita pnpm vita models --available
docker compose exec vita pnpm vita doctor
```

Open **http://127.0.0.1:4317**, enter the setup code from the log, and create the first admin in the UI. Choose a default and a different checker model in Settings. Use the welcome import/interview flow, then generate a master under Me → Base resumes. Data and refreshed Pi credentials persist in writable `vita-home` and `pi-agent` mounts owned by uid 1000.

## Native quick path

Install Node **22.19+**, pnpm **10.28.2**, git, Tectonic **0.17.0**, and poppler (`pdftotext`, `pdfinfo`). From a checkout:

```sh
corepack enable
pnpm install --frozen-lockfile --prefer-offline
export VITA_DATA_DIR="$HOME/vita-home"
pnpm vita setup
pnpm vita login
pnpm vita models --available
scripts/install-service.sh
pnpm vita doctor
```

Open port 4317; loopback setup requires no code. Logs: `journalctl --user -u vita -f`. The installer builds web and loads checkout `.env` for the service; foreground CLI/server commands require exported environment variables. Always use absolute data/workspace paths. For development, run `pnpm server` and `pnpm web` in separate terminals; Vite serves port 5173.
