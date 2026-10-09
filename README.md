# Vita

Vita is an open-source, self-hosted resume studio. Keep an honest outline of your work and an evidence inventory, generate a complete master resume and bases for different career directions, then paste a job to get a tailored resume checked against your sources. Review and edit it, export Markdown and a LaTeX PDF, and prepare for the interview. Your workspace is plain files in a git repository you own; model access runs through the Pi SDK.

## Principles

- Truth over polish: no invented employers, skills, numbers or outcomes. Every claim needs a receipt.
- Ask when facts are missing. Gaps become questions and interview preparation.
- Facts once, resumes many: outline + evidence → master → bases → jobs.
- A separate checker model reviews the writer. Mechanical honesty and export rules live in code.
- You approve source changes; your edits lock bullets against regeneration.
- PDFs must compile, fit their page budget and preserve text and reading order.
- Your files and your models: profession knowledge, templates, rules and instructions are extensible data.
- Job posts, web pages and uploads remain untrusted data. Cost and usage are recorded per role.

The full [design principles](docs/specs/2026-10-09-vita-design.md#3-principles) are binding constraints.

## Screenshots

Fictional example data.

| Resume workspace | Interview prep |
| --- | --- |
| ![Resume workspace with chat](docs/screenshots/resume-workspace.png) | ![Interview prep with honest gap answers](docs/screenshots/interview-prep.png) |
| **Projects and the metric interview** | **Base resumes** |
| ![Projects with a metric question](docs/screenshots/projects.png) | ![Master and base resumes](docs/screenshots/base-resumes.png) |

On a phone, in dark mode, with details shown:

<img src="docs/screenshots/workspace-phone-dark.png" alt="Resume workspace on a phone with job match details" width="260">

## Quick start: Docker

From a checkout, with Docker Compose installed:

```sh
cp .env.example .env
mkdir -p vita-data
# The non-root container runs as UID/GID 1000. On Linux, if needed:
sudo chown 1000:1000 vita-data
docker compose build
# Read a password without terminal echo (Bash):
read -r -s -p 'Vita password: ' VITA_PASSWORD; printf '\n'
printf '%s' "$VITA_PASSWORD" | docker run --rm -i --entrypoint pnpm vita:local --silent vita hash-password
unset VITA_PASSWORD
```

Put the resulting hash in `.env` as `VITA_PASSWORD_HASH='scrypt$…'`, keeping the single quotes so Compose preserves `$`. Then:

```sh
docker compose up -d
```

Open **http://127.0.0.1:4317**; use username `vita` and your password. An empty `vita-data` directory is initialized on startup. Add your name/contact in `profile.yaml`, outline and evidence, and configure distinct writer/checker models before generating.

Use provider keys in `.env`, or uncomment the read-only `~/.pi/agent` mount in `compose.yaml` to import Pi OAuth/subscription logins. Docker includes checksum-verified Tectonic 0.17.0, poppler, git and a warmed TeX cache. [Installation and self-hosting](docs/INSTALL.md) covers credentials, permissions, backups and TLS.

## Quick start: local development

Install Node.js 22, pnpm 10.28.2, git, Tectonic 0.17.0 and poppler (`pdftotext`, `pdfinfo`), then:

```sh
corepack enable
pnpm install --frozen-lockfile --prefer-offline
pnpm vita setup
pnpm vita init "$PWD/vita-data" --name 'Your Name'
VITA_WORKSPACE="$PWD/vita-data" pnpm server
# Another terminal:
pnpm web
```

Open **http://127.0.0.1:5173** for Vite development. For the built app, run `pnpm build:web` and open port 4317. The root `pnpm vita` command runs inside `cli/`; use absolute paths such as `"$PWD/vita-data"`. Provider environment variables must be available to the server process; local startup does not automatically load `.env`.

## How it works

1. Write freely in `outline.md`. Record sources, claims, limits and measured or counted outcomes in `projects.md`. `profile.yaml` supplies your name and contact details; models do not write the header.
2. Generate a master resume (up to two pages). Create bases from the master for career directions, with packs, emphasis, a template and page budget.
3. Paste a job. An analyst extracts requirements, code selects evidence, and a writer drafts from linked claims. Missing requirements are recorded as gaps.
4. Code flags unsourced numbers, missing claims, limit breaches, wording and layout problems. A different checker model reviews support; ATS and PDF checks assess coverage, extracted text and reading order. Revisions are bounded.
5. Review remaining questions, edit directly or through chat, and export when the checks pass. User edits lock bullets; source changes and layer synchronization are proposals for approval. Interview prep uses supported evidence and calls out gaps.

`vita check` checks source/schema/claim integrity; it does **not** replace the pipeline's independent checker or export gate. `vita render` compiles an existing master/base and checks its PDF; job outputs are managed by the generation pipeline.

## Configuration

Configuration lives in the **workspace**, separately from the app checkout.

| File or setting | Purpose |
| --- | --- |
| `config/models.yaml` | `default: provider/model-id`, plus `roles` overrides. Choose different resolved models for `writer` and `checker`; the checker cannot fall back to the writer model. |
| Pi `~/.pi/agent/auth.json` or provider env keys | OAuth/subscription credentials or keys such as `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. Docker accepts the optional read-only Pi mount described above. |
| `config/mcp.json` | Pi-format `mcpServers`; secrets through `${ENV}` or `!command`. Research permits explicitly read-only tools and allow-listed web URLs. Use least-privilege credentials. |
| `instructions.md` | Workspace guidance; optional frontmatter selects `roles` and research `sources.urls` / `sources.mcp`. Instance guidance uses `VITA_INSTANCE_DIR/instructions/*.md`; job notes and chat add narrower guidance. Core invariants and write policies remain enforced. |
| `config/rules.yaml` | Page budgets, bullet length, banned phrases, required sections, section order, date format and locale. |
| `packs/<id>/pack.yaml` | Profession vocabulary, keyword groups, metric questions and writing guidance; workspace packs override bundled IDs. `general` works across professions, with bundled IT packs available. |
| `templates/<id>/` | LaTeX template contract and bounded layout knobs; workspace templates take precedence over bundled templates. Rover Base is currently bundled. |
| `skills/<name>/SKILL.md` | Workspace role guidance overrides the bundled skill with the same name. |

Role overrides currently include `analyst`, `writer`, `checker`, `ats-reviewer`, `resume-editor`, `source-editor`, `researcher`, `interviewer` and `template-adopter`. Base generation uses the writer model with the `build-base` skill. Settings and the effective-prompt API expose configuration and instruction warnings. See [architecture](docs/ARCHITECTURE.md) and [contributing](CONTRIBUTING.md) for extension contracts.

Server variables: `VITA_WORKSPACE`, `VITA_HOST` (default `127.0.0.1`), `VITA_PORT` (4317), `VITA_PASSWORD_HASH`, optional `VITA_INSTANCE_DIR`, and optional `VITA_PUBLIC_ORIGIN` (public URL when a reverse proxy rewrites `Host`). A non-loopback bind requires a valid scrypt hash. This is a single-user deployment.

## CLI reference

Run commands as `pnpm vita <command>` from the checkout; paths resolve from `cli/`.

| Command | Purpose / options |
| --- | --- |
| `init <dir> [--name <name>]` | Initialize a workspace; refuses an existing outline. |
| `import <dir> --projects <legacy.md>` | Import evidence and preserve free prose. Optional `--outline`, `--name`, `--headline`, repeatable `--contact 'Label=value[=url]'`. Writes source files; back up an existing workspace first. |
| `setup` | Download TeX packages by compiling trusted bundled templates. Needed before offline renders. |
| `hash-password` | Read one password from stdin; print the server's scrypt hash. |
| `master <dir>` | Generate and check a master resume. Requires a named profile and configured provider access. |
| `tailor <dir> --job <file\|->` | Generate/check a job resume; optional `--base <id>` and `--slug <slug>`. `-` reads job text from stdin. |
| `render <dir> [--resume <id>] [--out <dir>]` | Compile a master/base (default `master`) to PDF, Markdown and TeX and check extracted text/pages. |
| `check <dir> [--resume <id>]` | Validate source schemas and linked claims for a master/base. |

Example: `pnpm vita tailor "$PWD/vita-data" --job "$PWD/job.md" --base my-direction`. Generation returns a nonzero status when the final review is not done; read the reported questions and blockers.

## Project status

Vita is pre-release. M0–M4 backend work covers evidence, generation, editing, rendering, templates, synchronization, research, instructions and metrics. Frontend polish and release verification are in progress. One Rover template is bundled today; additional designs and screenshots remain planned. CI runs package typechecks, full faux-provider test suites and real PDF render tests; tagged releases build amd64/arm64 GHCR images with provenance and SBOMs. No stable release is promised yet.

See [installation](docs/INSTALL.md), [contribution guide](CONTRIBUTING.md), [security reporting](SECURITY.md) and the [design spec](docs/specs/2026-10-09-vita-design.md).

## Licence and attribution

Vita code is **AGPL-3.0-only**; see [LICENSE](LICENSE). The bundled Rover Base template is adapted from [subidit's Rover resume templates](https://github.com/subidit/rover-resume), remains **CC BY 4.0**, and credits the author and modifications in [NOTICE](NOTICE) and its metadata. Preserve those notices when redistributing.
