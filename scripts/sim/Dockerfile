# Disposable fresh-machine image for scripts/fresh-env-sim.mjs (dev/ops tooling, not shipped:
# package.json `files: ["dist"]` keeps scripts/ out of the npm tarball).
#
# The base node:*-bookworm-slim image already IS the "all binaries missing" box: git, tmux, ttyd and
# claude are all absent, only apt-get is present. So variants ADD tools rather than remove them, and
# the only-Node box is produced by taking apt-get off PATH (last layer).

ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim

# Re-declared AFTER the FROM on purpose: an ARG declared before FROM is only in scope for the FROM
# itself, so without these lines every RUN below would read an empty value and all variants would
# build identically.
ARG TOOLS=none
ARG PKG_MANAGER=apt

# procps ships `ps` in every variant so the ttyd-orphan scan exercises its real path instead of its
# ps-missing tolerant fallback. TOOLS=tmuxgit adds tmux + git but deliberately NOT ttyd and NOT
# claude, so that one image doubles as the ttyd-missing box.
RUN apt-get update \
    && apt-get install -y --no-install-recommends procps \
    && if [ "$TOOLS" = "tmuxgit" ]; then \
    apt-get install -y --no-install-recommends tmux git; \
    fi \
    && rm -rf /var/lib/apt/lists/*

COPY dispatch.tgz /tmp/dispatch.tgz
RUN npm install -g /tmp/dispatch.tgz && rm /tmp/dispatch.tgz

# LAST, so the layers above could still use apt-get: moving it off PATH is what makes
# detectPackageManager find nothing and puts the generic-hint fallback under test.
RUN if [ "$PKG_MANAGER" = "none" ]; then \
    mv /usr/bin/apt-get /usr/bin/apt-get.disabled; \
    fi
