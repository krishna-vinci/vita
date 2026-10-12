# Task: Update the Vita site for the shipped M6 release and the self-hosting guide

You are the IMPLEMENTER in /home/krishna/vita-site (its own git repo, branch main). Do not load orchestrator or workflow skills and do not spawn sub-agents; an orchestrator reviews and commits your work. Never add AI attribution anywhere. Do not commit.

## Goal
The site still says onboarding, all Rover templates, cover letters, memory, the tracker and the efficiency work are "coming in the next release". They have shipped. The site's install and model docs must also match the app's new self-hosting guide, so that someone can self-host from the site alone.

## Sources of truth (read-only; in /home/krishna/project-remote/vita)
- `README.md`: features, quick starts, configuration, CLI, project status. Mirror its facts.
- `docs/SELF_HOSTING.md`: the complete guide. It covers Docker (writable `./pi-agent:/pi-agent`), `vita login` with `/login`, `vita models --available`, `vita doctor`, API keys, local models through Ollama or llama.cpp with `models.json`, roles and model choice, TLS/proxy, accounts, GitHub research (no `gh`, optional token), backups, upgrades, troubleshooting and the native systemd installer.
- `docs/plans/2026-10-10-m6-continuity.md` for feature detail.
- Screenshots (fictional data) to use: `docs/screenshots/{tracker-board,memory,templates}.png`, plus `/tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/ui/{c1-after-setup,c2-login-error,c4-timeline-1440,c4-letter-empty-1440,c5-start-390d}.png` (start page, login, timeline, cover letter, onboarding on a phone).

## Changes
1. **Landing:**
   - Replace "Coming in the next release" with real sections for **Getting started** (import an old resume, a guided interview, a starter outline, accounts), **Templates** (the 12 Rover templates gallery screenshot), **Cover letters** (same checks), **Tracker and memory** (screenshots) and **Efficiency** (about half the cost on a real job, no check weakened).
   - Keep the existing design system, Motion diagrams and tone. Add a short "What's next" with backups, more profession packs and optional classifier routing.
2. **Docs, Starlight:**
   - Rewrite **Install** from SELF_HOSTING: Docker and native, the setup code and the first admin.
   - Add **Connect a model** (subscriptions via `vita login`, API keys, local models, `vita models`, `vita doctor`).
   - Rewrite **Models and providers**: the role table with plain descriptions, and choosing a different checker.
   - Add **Accounts and users**, **Onboarding**, **Cover letters**, **Tracker**, **Memory** and **Troubleshooting** (the table from SELF_HOSTING).
   - Update **GitHub research**: no `gh` needed, public repos work, an optional fine-grained token, MCP is advanced.
   - Update **Templates**: 12 bundled templates, the gallery, upload.
   - Update the **CLI reference** for login, models, doctor, users, reset-password and setup.
   - Update the sidebar groups accordingly.
3. **Links:** point every repo link to https://github.com/krishna-vinci/vita (public now). Link the full guide on GitHub from the install docs.
4. Keep everything under `/landing`. `pnpm build:check` must pass, with the route assertion.
5. **Screenshots:**
   - Re-shoot the changed pages at 390 and 1440 px, light and dark, into `docs/screenshots/`, as before. Use scripts/shoot.mjs with Chrome, or the CDP driver at /tmp/claude-1000/-home-krishna-project-remote/c52ff2bf-4769-4561-99a2-cd92d2e5a706/scratchpad/cdp.mjs.
   - Look at them and fix any layout issues.
   - Never run `pkill -f` with a pattern that matches your own shell command. Stop the preview server by its PID.
6. **Site docs:** update `docs/SPEC.md` and `docs/PLAN.md` briefly.

## Checks
- `pnpm install`
- `pnpm build:check`
- The screenshots above

End with a report: changed files, build result, screenshot paths, anything not done.
