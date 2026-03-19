#!/bin/bash
set -euo pipefail

echo "=== Post-Create Setup ==="

# Ensure Claude Code is up to date
if command -v claude &> /dev/null; then
  echo "Claude Code CLI found: $(claude --version 2>/dev/null || echo 'installed')"
else
  echo "Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code@latest
fi

# Configure git defaults if not set
git config --global init.defaultBranch main 2>/dev/null || true
git config --global pull.rebase false 2>/dev/null || true

echo "=== Post-Create Setup Complete ==="
