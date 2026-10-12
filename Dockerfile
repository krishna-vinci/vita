# syntax=docker/dockerfile:1

FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY core/package.json core/
COPY cli/package.json cli/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web

FROM node:22-slim AS runtime
ARG TARGETARCH
ARG VERSION=dev
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_ENV=production HOME=/home/vita XDG_CACHE_HOME=/home/vita/.cache \
    VITA_HOST=0.0.0.0 VITA_PORT=4317 VITA_DATA_DIR=/data PI_CODING_AGENT_DIR=/pi-agent
RUN corepack enable pnpm \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Official 0.17.0 musl archives; hashes computed from both release downloads.
RUN set -eu; \
    case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) arch=x86_64; sha=8533d07f9ccbd7a65824b9e0459041bca34af1eb33daba48f59215593753a3b7 ;; \
      arm64) arch=aarch64; sha=b10954a95404f3ab2328d2fa59a5ebab8e657f893fab096f98be8db7c0c979b8 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --connect-timeout 20 --max-time 300 --retry 3 \
      "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.17.0/tectonic-0.17.0-${arch}-unknown-linux-musl.tar.gz" \
      -o /tmp/tectonic.tar.gz; \
    printf '%s  /tmp/tectonic.tar.gz\n' "$sha" | sha256sum -c -; \
    tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic; \
    chmod 0755 /usr/local/bin/tectonic; \
    rm /tmp/tectonic.tar.gz; \
    tectonic --version

LABEL org.opencontainers.image.source="https://github.com/krishna-vinci/vita" \
    org.opencontainers.image.description="Self-hosted, evidence-backed resume studio" \
    org.opencontainers.image.licenses="AGPL-3.0-only" \
    org.opencontainers.image.version="${VERSION}"

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY core/package.json core/
COPY cli/package.json cli/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile --prod --filter '@vita/server...' --filter '@vita/cli...' \
    && rm -rf /pnpm/store
COPY tsconfig.base.json LICENSE NOTICE ./
COPY shared/src ./shared/src
COPY core/src ./core/src
COPY cli/src ./cli/src
COPY server/src ./server/src
COPY skills ./skills
COPY packs ./packs
COPY templates ./templates
COPY --from=build /app/web/dist ./web/dist

# UID 1000 matches the usual host user. The app and its executable stay root-owned.
RUN groupmod --new-name vita node \
    && usermod --login vita --home /home/vita node \
    && mkdir -p /data /home/vita/.cache \
    && chown -R vita:vita /data /home/vita

USER vita
# Warm as the runtime user so --only-cached compiles see the same writable cache.
RUN pnpm vita setup
EXPOSE 4317
# Public health does not require account setup or a session.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e 'fetch("http://127.0.0.1:" + (process.env.VITA_PORT || "4317") + "/api/health", {signal: AbortSignal.timeout(4000)}).then(async r => {const b = await r.json(); if (!r.ok || b.ok !== true) process.exit(1)}).catch(() => process.exit(1))'
WORKDIR /app
CMD ["pnpm", "--filter", "@vita/server", "exec", "node", "--import", "tsx", "src/main.ts"]
