# Single-image Firmus Novus — bakes anvil + the three Next.js apps + their seeds.
#
# Build: docker build -t firmus-novus .
# Run:   docker run --rm -p 3000:3000 firmus-novus
#
# At container start, the entrypoint spins up anvil locally, deploys the
# contracts, migrates + seeds both SQLite DBs, then starts proxy + web + issuer
# under a single pnpm process. The proxy on :3000 is the only port exposed.
#
# A Debian-based node image is used because Foundry's prebuilt binaries assume
# glibc (Alpine's musl breaks them).

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# OS deps. curl + ca-certificates for foundryup, git for foundry's lib install,
# python3 for native-module builds, openssl for prisma engine downloads.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl ca-certificates git python3 build-essential openssl jq && \
    rm -rf /var/lib/apt/lists/*

# Foundry / anvil — install for root since the container runs as root.
ENV PATH="/root/.foundry/bin:${PATH}"
RUN curl -L https://foundry.paradigm.xyz | bash && \
    /root/.foundry/bin/foundryup

# pnpm — pinned to the workspace's packageManager version.
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# ---- Stage 1: dependency install (cacheable) -------------------------------
# Copy ONLY the workspace manifests so `pnpm install` cache survives source
# edits. Add new package.jsons here whenever a new app/package is created.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/issuer/package.json apps/issuer/
COPY apps/proxy/package.json apps/proxy/
COPY packages/dcql/package.json packages/dcql/
COPY packages/sd-jwt/package.json packages/sd-jwt/
COPY packages/oid4vci/package.json packages/oid4vci/
COPY packages/db-toolkit/package.json packages/db-toolkit/
COPY packages/crypto/package.json packages/crypto/
RUN pnpm install --frozen-lockfile

# ---- Stage 2: source copy + builds -----------------------------------------
COPY . .

# Prisma client must be generated before next build (the build imports the
# Prisma types). Schema lives in apps/web/prisma.
RUN pnpm --filter @firmus/web exec prisma generate

# Production builds. Issuer + web compile to .next/. Proxy is tsx-served at
# runtime so no build step is needed for it.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @firmus/web build && \
    pnpm --filter @firmus/issuer build

# Pre-compile contracts so the entrypoint's `forge script` is fast on cold
# start and doesn't re-download solc on every container run.
RUN cd contracts && /root/.foundry/bin/forge build

# Entrypoint script — copied last so iterating on it doesn't bust the build cache.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

# Health: wait for the proxy to answer 200/3xx on `/`. Generous start-period
# because the entrypoint's anvil + deploy + seeds takes ~20-30s.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000 || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
