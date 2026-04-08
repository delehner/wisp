#!/bin/bash
set -uo pipefail

echo "=== Post-Start Setup ==="

# Initialize firewall (non-fatal — the container is still usable without it)
if [ "$(id -u)" -eq 0 ]; then
  /usr/local/bin/init-firewall.sh || echo "Warning: Firewall init failed (non-fatal)"
elif command -v sudo &> /dev/null; then
  sudo /usr/local/bin/init-firewall.sh || echo "Warning: Firewall init failed (non-fatal)"
else
  echo "Warning: Cannot initialize firewall (no root/sudo access)"
fi

echo "=== Post-Start Setup Complete ==="
