#!/bin/bash
# =============================================================================
# provider.sh — AI provider abstraction layer
# =============================================================================
# Abstracts the differences between Claude Code and Gemini CLI so the pipeline
# scripts can work with either provider. Selected via AI_PROVIDER env var.
#
# Supported providers: claude, gemini

AI_PROVIDER="${AI_PROVIDER:-claude}"

provider_cli() {
  case "$AI_PROVIDER" in
    claude) echo "claude" ;;
    gemini) echo "gemini" ;;
    *) echo "Unknown AI_PROVIDER: $AI_PROVIDER" >&2; return 1 ;;
  esac
}

provider_npm_package() {
  case "$AI_PROVIDER" in
    claude) echo "@anthropic-ai/claude-code@latest" ;;
    gemini) echo "@google/gemini-cli@latest" ;;
  esac
}

provider_context_filename() {
  case "$AI_PROVIDER" in
    claude) echo "CLAUDE.md" ;;
    gemini) echo "GEMINI.md" ;;
  esac
}

provider_api_key_var() {
  case "$AI_PROVIDER" in
    claude) echo "ANTHROPIC_API_KEY" ;;
    gemini) echo "GEMINI_API_KEY" ;;
  esac
}

provider_default_model() {
  case "$AI_PROVIDER" in
    claude) echo "${CLAUDE_MODEL:-sonnet}" ;;
    gemini) echo "${GEMINI_MODEL:-gemini-2.5-pro}" ;;
  esac
}

provider_default_allowed_tools() {
  case "$AI_PROVIDER" in
    claude) echo "${CLAUDE_ALLOWED_TOOLS:-Edit,Write,Bash,Read,MultiEdit}" ;;
    gemini) echo "" ;;
  esac
}

# Execute the AI CLI in headless mode.
# Usage: provider_run <prompt_file> <model> <allowed_tools> <output_format> [verbose]
# Caller handles piping stdout/stderr to log-formatter, tee, etc.
provider_run() {
  local prompt_file="$1"
  local model="$2"
  local allowed_tools="$3"
  local output_format="$4"
  local verbose="${5:-false}"

  case "$AI_PROVIDER" in
    claude)
      local args=(-p "$(cat "$prompt_file")" --model "$model" --dangerously-skip-permissions --output-format "$output_format")
      if [ -n "$allowed_tools" ]; then
        args+=(--allowedTools "$allowed_tools")
      fi
      if [ "$verbose" = true ]; then
        args+=(--verbose)
      fi
      claude "${args[@]}"
      ;;
    gemini)
      gemini -p "$(cat "$prompt_file")" \
        --model "$model" \
        --yolo \
        --output-format "$output_format"
      ;;
  esac
}

# Return auth-check command string (for running inside dev containers)
provider_auth_check_cmd() {
  case "$AI_PROVIDER" in
    claude) echo "claude auth status" ;;
    gemini) echo "gemini auth status" ;;
  esac
}

# Extract session ID from a JSONL log file.
# Usage: provider_extract_session_id <jsonl_file>
# Prints the session ID or empty string.
provider_extract_session_id() {
  local jsonl_file="$1"

  case "$AI_PROVIDER" in
    claude)
      head -5 "$jsonl_file" | jq -r 'select(.session_id) | .session_id' 2>/dev/null | head -1
      ;;
    gemini)
      head -10 "$jsonl_file" | jq -r 'select(.sessionId // .session_id) | (.sessionId // .session_id)' 2>/dev/null | head -1
      ;;
  esac
}

# Return the resume command for a session.
# Usage: provider_resume_hint <session_id>
provider_resume_hint() {
  local session_id="$1"
  echo "$(provider_cli) --resume $session_id"
}

# Validate the provider CLI is installed.
# Returns 0 if installed, 1 if not. Prints install instructions on failure.
provider_validate_cli() {
  local cli
  cli=$(provider_cli)

  if ! command -v "$cli" &> /dev/null; then
    echo "$cli CLI is not installed. Install with: npm install -g $(provider_npm_package)" >&2
    return 1
  fi
  return 0
}

# Check if the provider API key is set.
# Prints an info message if unset (non-fatal, provider may use subscription auth).
provider_check_api_key() {
  local key_var
  key_var=$(provider_api_key_var)
  local key_val="${!key_var:-}"

  if [ -z "$key_val" ]; then
    case "$AI_PROVIDER" in
      claude) echo "INFO" "ANTHROPIC_API_KEY is not set — will use Claude Max subscription auth" ;;
      gemini) echo "INFO" "GEMINI_API_KEY is not set — will use Google account auth" ;;
    esac
    return 0
  fi
  return 0
}
