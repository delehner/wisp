#!/bin/bash
set -uo pipefail

# Network firewall for dev container security.
# Default-deny outbound, whitelist only necessary services.
# Run with sudo/root privileges.
# Exits gracefully (code 0) when iptables is unavailable or NET_ADMIN is missing.

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: init-firewall.sh must be run as root"
  exit 1
fi

if ! command -v iptables &> /dev/null; then
  echo "Warning: iptables not available, skipping firewall setup"
  exit 0
fi

if ! iptables -L -n &> /dev/null; then
  echo "Warning: iptables not permitted (missing NET_ADMIN capability?), skipping firewall setup"
  exit 0
fi

iptables -F OUTPUT
iptables -P OUTPUT DROP

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# HTTPS (443) — required for API calls, git, npm
iptables -A OUTPUT -p tcp --dport 443 -j ACCEPT

# HTTP (80) — some package registries
iptables -A OUTPUT -p tcp --dport 80 -j ACCEPT

# SSH (22) — git over SSH
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

echo "Firewall initialized: default-deny with allowlist for DNS, HTTP/S, SSH"
