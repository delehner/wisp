FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

RUN apt-get update && apt-get install -y \
    curl \
    git \
    iptables \
    jq \
    zsh \
    fzf \
    ripgrep \
    fd-find \
    && rm -rf /var/lib/apt/lists/*

COPY .devcontainer/init-firewall.sh /usr/local/bin/init-firewall.sh
RUN chmod +x /usr/local/bin/init-firewall.sh

USER vscode
WORKDIR /workspaces
