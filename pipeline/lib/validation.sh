#!/bin/bash
# Validation utilities for the pipeline.
# Requires provider.sh to be sourced first (for provider_validate_cli, provider_api_key_var).

validate_prd() {
  local prd_file="$1"

  if [ ! -f "$prd_file" ]; then
    log "ERROR" "PRD file not found: $prd_file"
    return 1
  fi

  local has_title has_overview has_requirements
  has_title=$(grep -c '^# ' "$prd_file" 2>/dev/null || echo "0")
  has_overview=$(grep -ci 'overview\|summary\|description' "$prd_file" 2>/dev/null || echo "0")
  has_requirements=$(grep -ci 'requirements\|features\|scope' "$prd_file" 2>/dev/null || echo "0")

  if [ "$has_title" -eq 0 ]; then
    log "WARN" "PRD missing a title (# heading)"
  fi

  if [ "$has_overview" -eq 0 ]; then
    log "WARN" "PRD may be missing an overview/summary section"
  fi

  if [ "$has_requirements" -eq 0 ]; then
    log "WARN" "PRD may be missing a requirements/features section"
  fi

  return 0
}

validate_environment() {
  local errors=0

  if ! provider_validate_cli; then
    errors=$((errors + 1))
  fi

  if ! command -v git &> /dev/null; then
    log "ERROR" "git is not installed"
    errors=$((errors + 1))
  fi

  if ! command -v gh &> /dev/null; then
    log "WARN" "GitHub CLI (gh) is not installed. PR creation will be skipped."
  fi

  local key_var
  key_var=$(provider_api_key_var)
  if [ -z "${!key_var:-}" ]; then
    case "$AI_PROVIDER" in
      claude) log "INFO" "ANTHROPIC_API_KEY is not set — will use Claude Max subscription auth" ;;
      gemini) log "INFO" "GEMINI_API_KEY is not set — will use Google account auth" ;;
    esac
  fi

  return "$errors"
}

validate_devcontainer_deps() {
  local errors=0

  if ! command -v docker &> /dev/null; then
    log "ERROR" "Docker is not installed. Install from https://www.docker.com/products/docker-desktop/"
    errors=$((errors + 1))
  elif ! docker info &> /dev/null; then
    log "ERROR" "Docker daemon is not running. Start Docker Desktop and try again."
    errors=$((errors + 1))
  fi

  if ! command -v devcontainer &> /dev/null; then
    log "ERROR" "Dev Containers CLI is not installed. Install with: npm install -g @devcontainers/cli"
    errors=$((errors + 1))
  fi

  return "$errors"
}

validate_agent_output() {
  local workdir="$1"
  local agent="$2"

  local progress_file="$workdir/.agent-progress/$agent.md"

  if [ ! -f "$progress_file" ]; then
    log "WARN" "Agent $agent did not produce a progress file"
    return 1
  fi

  local status
  status=$(grep '## Status:' "$progress_file" 2>/dev/null | head -1 | sed 's/.*## Status:[[:space:]]*//' | xargs || echo "UNKNOWN")

  case "$status" in
    COMPLETED)
      log "INFO" "Agent $agent completed successfully"
      return 0
      ;;
    BLOCKED)
      log "ERROR" "Agent $agent is blocked"
      grep -A 5 '## Blockers' "$progress_file" 2>/dev/null
      return 1
      ;;
    *)
      log "WARN" "Agent $agent status: $status (may need more iterations)"
      return 1
      ;;
  esac
}
