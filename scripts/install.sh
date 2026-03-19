#!/bin/bash
set -euo pipefail

# =============================================================================
# Coding Agents Pipeline — Binary Installer
# =============================================================================
# Downloads the pre-built `ca` binary for your platform from GitHub Releases.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/delehner/coding-agents/main/cli/scripts/install.sh | bash
#   curl ... | bash -s -- --dir /usr/local/bin
#   curl ... | bash -s -- --version v0.2.0
#   curl ... | bash -s -- --uninstall

REPO="delehner/coding-agents"
BINARY_NAME="ca"
DEFAULT_INSTALL_DIR="/usr/local/bin"

if [ -t 1 ]; then
  RESET='\033[0m'; BOLD='\033[1m'; GREEN='\033[32m'
  CYAN='\033[36m'; YELLOW='\033[33m'; RED='\033[31m'
else
  RESET='' BOLD='' GREEN='' CYAN='' YELLOW='' RED=''
fi

info()  { echo -e "${CYAN}${BOLD}==>${RESET} $1"; }
warn()  { echo -e "${YELLOW}${BOLD}warning:${RESET} $1"; }
error() { echo -e "${RED}${BOLD}error:${RESET} $1" >&2; }
ok()    { echo -e "${GREEN}${BOLD}  ✓${RESET} $1"; }

INSTALL_DIR="$DEFAULT_INSTALL_DIR"
VERSION="latest"
UNINSTALL=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --uninstall) UNINSTALL=true; shift ;;
    -h|--help)
      cat <<'HELP'
Coding Agents Pipeline — Binary Installer

Usage:
  curl -fsSL <url>/install.sh | bash
  curl -fsSL <url>/install.sh | bash -s -- [options]

Options:
  --dir <path>       Directory to install the binary (default: /usr/local/bin)
  --version <tag>    Specific release version (default: latest)
  --uninstall        Remove the ca binary
  -h, --help         Show this help
HELP
      exit 0 ;;
    *) error "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ "$UNINSTALL" = true ]; then
  info "Uninstalling ca..."
  if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
    rm -f "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null || sudo rm -f "$INSTALL_DIR/$BINARY_NAME"
    ok "Removed $INSTALL_DIR/$BINARY_NAME"
  else
    warn "$INSTALL_DIR/$BINARY_NAME not found"
  fi
  exit 0
fi

echo ""
echo -e "${BOLD}Coding Agents Pipeline — Installer${RESET}"
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) TARGET_OS="apple-darwin" ;;
  Linux)  TARGET_OS="unknown-linux-gnu" ;;
  *)      error "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) TARGET_ARCH="x86_64" ;;
  arm64|aarch64) TARGET_ARCH="aarch64" ;;
  *)             error "Unsupported architecture: $ARCH"; exit 1 ;;
esac

TARGET="${TARGET_ARCH}-${TARGET_OS}"
info "Platform: $TARGET"

if [ "$VERSION" = "latest" ]; then
  info "Fetching latest release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
  if [ -z "$VERSION" ]; then
    error "Could not determine latest version. Specify --version manually."
    exit 1
  fi
fi

info "Version: $VERSION"

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/ca-${TARGET}.tar.gz"
info "Downloading from $DOWNLOAD_URL..."

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMPDIR/ca.tar.gz"; then
  error "Download failed. Check the version and try again."
  error "URL: $DOWNLOAD_URL"
  exit 1
fi

tar -xzf "$TMPDIR/ca.tar.gz" -C "$TMPDIR"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPDIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
  chmod +x "$INSTALL_DIR/$BINARY_NAME"
else
  warn "$INSTALL_DIR is not writable — using sudo"
  sudo mv "$TMPDIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
  sudo chmod +x "$INSTALL_DIR/$BINARY_NAME"
fi

ok "Installed $BINARY_NAME to $INSTALL_DIR/$BINARY_NAME"

echo ""
if command -v ca &>/dev/null; then
  ok "ca is available ($(ca --version 2>/dev/null || echo "$VERSION"))"
else
  warn "ca was installed but not found in PATH"
  warn "Add $INSTALL_DIR to your PATH:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${RESET}"
echo ""
echo "  Run 'ca --help' to get started."
echo "  To update: re-run this install script"
echo "  To remove: re-run with --uninstall"
echo ""
