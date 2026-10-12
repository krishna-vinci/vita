#!/usr/bin/env bash
# Install a systemd user unit using the current checkout and tool paths.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
node_path="$(command -v node)"
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not on PATH; run corepack enable and rerun." >&2
  exit 1
fi
pnpm_path="$(command -v pnpm)"
data_dir="${VITA_DATA_DIR:-$HOME/vita-home}"
case "$data_dir" in
  /*) ;;
  *) echo "VITA_DATA_DIR must be an absolute path." >&2; exit 1 ;;
esac
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd user services are required; see docs/SELF_HOSTING.md for foreground startup." >&2
  exit 1
fi
mkdir -p "$unit_dir" "$data_dir"
(cd "$repo_root" && "$pnpm_path" build:web)

# Quote systemd values (including spaces), and escape literal percent specifiers.
"$node_path" --input-type=module - "$repo_root" "$unit_dir" "$data_dir" "$node_path" "$pnpm_path" "$PATH" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
const [repo, unitDir, data, node, pnpm, shellPath] = process.argv.slice(2);
const pathValue = (value) => {
  if (/[\r\n\0]/.test(value)) throw new Error('Paths must not contain newlines or NUL');
  return value.replaceAll('%', '%%');
};
const quote = (value) => {
  if (/[\r\n\0]/.test(value)) throw new Error('Paths must not contain newlines or NUL');
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%') + '"';
};
let unit = readFileSync(join(repo, 'deploy/vita.service'), 'utf8');
unit = unit.replace('WorkingDirectory=@CHECKOUT@/server', `WorkingDirectory=${pathValue(join(repo, 'server'))}`)
  .replace('EnvironmentFile=-@CHECKOUT@/.env', `EnvironmentFile=-${pathValue(join(repo, '.env'))}`)
  .replace('Environment=VITA_DATA_DIR=@DATA_DIR@', `Environment=${quote('VITA_DATA_DIR=' + data)}`)
  .replace('Environment=PATH=@PATH@', `Environment=${quote('PATH=' + dirname(node) + ':' + dirname(pnpm) + ':' + shellPath)}`)
  .replace('@PNPM@', quote(pnpm)).replace('@NODE@', quote(node));
writeFileSync(join(unitDir, 'vita.service'), unit, { mode: 0o600 });
JS

systemctl --user daemon-reload
systemctl --user enable vita.service
systemctl --user restart vita.service
printf 'Vita is running. Open http://127.0.0.1:%s\n' "${VITA_PORT:-4317}"
printf 'Logs and any first-run setup code: journalctl --user -u vita -f\n'
printf 'Data: %s\nKeep running after logout: loginctl enable-linger %s\n' "$data_dir" "${USER:-$(id -un)}"
printf 'Provider login: cd "%s" && pnpm vita login\n' "$repo_root"
