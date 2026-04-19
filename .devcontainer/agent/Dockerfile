FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 22 from NodeSource (the `node:1` devcontainer feature has been
# moved into the build so the agent CLIs can be baked into a cached layer
# instead of installed by `postCreateCommand` at runtime, which OOM-kills on
# Docker Desktop default memory limits).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bake provider CLIs at build time so `claude` / `gemini` are guaranteed to
# exist inside the container without depending on a runtime npm install.
RUN npm install -g --no-audit --no-fund \
        @anthropic-ai/claude-code@latest \
        @google/gemini-cli@latest \
    && npm cache clean --force

USER vscode
WORKDIR /workspaces
