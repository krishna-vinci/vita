# Security

Report suspected vulnerabilities privately through the repository's **Security → Report a vulnerability** feature, when enabled. Include the affected revision/version, installation method, reproducible steps and impact; redact passwords, API keys, OAuth tokens and personal resume/evidence content. If private reporting is unavailable, ask the maintainer to enable it without publishing exploit or secret details in a public issue. Coordinate disclosure until a fix is available.

Vita is pre-release; no stable version currently has a support guarantee. Security fixes target the latest maintained revision/release. Do not assume earlier snapshots receive backports.

## Threat model

Vita is a self-hosted **single-user** application. The operator, workspace owner, configured provider and installed MCP executables are trusted. Job posts, fetched pages, external repositories, model output and uploaded LaTeX are untrusted. Model providers receive the context required for the requested task; local-first storage does not mean provider calls stay on the machine. There is no telemetry.

- **Prompt injection:** external content is wrapped and labelled as data. Core invariants, schema validation, per-role tool allowlists and write policies enforce boundaries beyond prompts. Research only permits explicitly read-only MCP tools; web sources are allow-listed. An agent proposes source/template changes for user approval.
- **LaTeX:** uploaded/generated content is pre-scanned for unsafe constructs. Assets are copied into a fresh confined temp directory, then Tectonic runs with `--untrusted` and `--only-cached`, a timeout and output-size caps. Uploaded paths/symlinks and escaping includes are rejected. Trusted bundled templates alone use network-enabled cache warm-up during setup/build. This is defense in depth, not a guarantee against an unknown compiler vulnerability.
- **Files and history:** workspace IO confines paths, rejects symlink escapes and uses locks/atomic writes. User-written unparsed text is preserved. Git records accepted changes without rewriting history; `.vita/` caches are excluded. Git history is an editing aid, not an encrypted backup.
- **Auth and origin:** native startup defaults to loopback. A non-loopback bind requires a valid scrypt password hash. HTTP Basic auth checks requests, including static UI and health; cross-origin writes with an Origin header are rejected. The password grants access to the whole workspace and provider-backed actions; there are no separate accounts or tenant boundaries.
- **Credentials:** provider keys/Pi logins and MCP secret interpolation stay outside workspace git. Docker imports credentials from an optional read-only host mount into a private writable copy for Pi locking/refresh. The image runs as non-root, and build context excludes secrets and user data.

## Operator responsibilities

Keep the published port on loopback, require a strong password, and use a TLS reverse proxy, trusted VPN or SSH tunnel for remote access. HTTP Basic credentials are not protected over public plaintext HTTP. Protect workspace files, `.env`, Pi credentials, container access and backups with OS permissions. Do not serve different untrusted users from one instance. Review MCP servers and template dependencies before enabling them; grant least-privilege access and restrict research network reachability. Keep Node, Pi, Tectonic and the base image patched.

See [installation and self-hosting](docs/INSTALL.md) and [spec §17](docs/specs/2026-10-09-vita-design.md#17-security-and-privacy) for setup and trust boundaries. Honesty checks improve resume grounding; they do not replace the user's review of facts or provide a security boundary against a malicious workspace owner.
