#!/bin/bash
set -euo pipefail

# =============================================================================
# run-agent.sh — Ralph Loop wrapper for a single agent
# =============================================================================
# Runs an AI agent (Claude Code or Gemini CLI) in a Ralph Loop: iteratively
# re-prompts with fresh context until the agent marks itself COMPLETED or max
# iterations are reached. Provider selected via AI_PROVIDER env var.
#
# Usage:
#   ./pipeline/run-agent.sh \
#     --agent <architect|designer|developer|tester|reviewer> \
#     --workdir <path-to-repo> \
#     --prd <path-to-prd> \
#     [--max-iterations <n>] \
#     [--model <model-name>] \
#     [--previous-agents <comma-separated>] \
#     [--verbose-logs] \
#     [--interactive]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE_DIR="$SCRIPT_DIR"

source "$PIPELINE_DIR/lib/progress.sh"
source "$PIPELINE_DIR/lib/provider.sh"
source "$PIPELINE_DIR/lib/validation.sh"

# --- Logging ---
LOG_LEVEL="${LOG_LEVEL:-info}"
LOG_DIR="${LOG_DIR:-./logs}"

log() {
  local level="$1"
  local msg="$2"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $msg" >&2

  mkdir -p "$LOG_DIR"
  echo "[$timestamp] [$level] $msg" >> "$LOG_DIR/pipeline.log"
}

# --- Argument Parsing ---
AGENT=""
WORKDIR=""
PRD_FILE=""
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-10}"
MODEL="$(provider_default_model)"
PREVIOUS_AGENTS=""
ALLOWED_TOOLS="$(provider_default_allowed_tools)"
VERBOSE_LOGS="${VERBOSE_LOGS:-false}"
INTERACTIVE="${INTERACTIVE:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent) AGENT="$2"; shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --prd) PRD_FILE="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --previous-agents) PREVIOUS_AGENTS="$2"; shift 2 ;;
    --allowed-tools) ALLOWED_TOOLS="$2"; shift 2 ;;
    --verbose-logs) VERBOSE_LOGS=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    *) log "ERROR" "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$AGENT" ] || [ -z "$WORKDIR" ] || [ -z "$PRD_FILE" ]; then
  echo "Usage: $0 --agent <name> --workdir <path> --prd <path> [--max-iterations <n>] [--model <name>] [--previous-agents <a,b,c>] [--verbose-logs] [--interactive]"
  exit 1
fi

# --- Resolve Paths ---
AGENTS_DIR="$PIPELINE_DIR/../agents"
AGENT_PROMPT_FILE="$AGENTS_DIR/$AGENT/prompt.md"
BASE_SYSTEM_FILE="$AGENTS_DIR/_base-system.md"

if [ ! -f "$AGENT_PROMPT_FILE" ]; then
  log "ERROR" "Agent prompt not found: $AGENT_PROMPT_FILE"
  exit 1
fi

# Check for agent-specific iteration override
AGENT_UPPER=$(echo "$AGENT" | tr '[:lower:]' '[:upper:]')
AGENT_MAX_VAR="${AGENT_UPPER}_MAX_ITERATIONS"
if [ -n "${!AGENT_MAX_VAR:-}" ]; then
  MAX_ITERATIONS="${!AGENT_MAX_VAR}"
  log "INFO" "Using agent-specific max iterations: $MAX_ITERATIONS"
fi

# --- Build the Prompt ---
build_prompt() {
  local iteration="$1"
  local prompt=""

  # Base system instructions
  prompt+="$(cat "$BASE_SYSTEM_FILE")\n\n"

  # Agent-specific prompt
  prompt+="$(cat "$AGENT_PROMPT_FILE")\n\n"

  # PRD content
  prompt+="# PRD (Product Requirements Document)\n\n"
  prompt+="$(cat "$PRD_FILE")\n\n"

  # Previous agents' progress
  if [ -n "$PREVIOUS_AGENTS" ]; then
    IFS=',' read -ra PREV_AGENTS <<< "$PREVIOUS_AGENTS"
    local prev_context
    prev_context=$(get_previous_agents_context "$WORKDIR" "${PREV_AGENTS[@]}")
    if [ -n "$prev_context" ]; then
      prompt+="# Context from Previous Agents\n\n"
      prompt+="$prev_context\n\n"
    fi
  fi

  # Current agent's own progress (from previous iterations)
  local own_progress="$WORKDIR/$PROGRESS_DIR/$AGENT.md"
  if [ -f "$own_progress" ]; then
    prompt+="# Your Progress from Previous Iterations\n\n"
    prompt+="$(cat "$own_progress")\n\n"
    prompt+="Continue where you left off. Check what's already done and work on the next incomplete task.\n\n"
  fi

  # Architecture docs (if they exist and this isn't the architect)
  if [ "$AGENT" != "architect" ]; then
    for doc in "$WORKDIR"/docs/architecture/*/architecture.md; do
      if [ -f "$doc" ]; then
        prompt+="# Architecture Document\n\n$(cat "$doc")\n\n"
        break
      fi
    done
  fi

  # Design docs (if they exist and this isn't the architect or designer)
  if [ "$AGENT" != "architect" ] && [ "$AGENT" != "designer" ]; then
    for doc in "$WORKDIR"/docs/architecture/*/design.md; do
      if [ -f "$doc" ]; then
        prompt+="# Design Document\n\n$(cat "$doc")\n\n"
        break
      fi
    done
  fi

  # Project-level context file (CLAUDE.md or GEMINI.md, depending on provider)
  local ctx_file
  ctx_file=$(provider_context_filename)
  if [ -f "$WORKDIR/$ctx_file" ]; then
    prompt+="# Project Instructions ($ctx_file)\n\n"
    prompt+="$(cat "$WORKDIR/$ctx_file")\n\n"
  fi

  # Iteration context
  prompt+="# Iteration Context\n\n"
  prompt+="This is iteration $iteration of $MAX_ITERATIONS.\n"
  prompt+="Agent: $AGENT\n"
  prompt+="Working directory: $WORKDIR\n\n"

  if [ "$iteration" -ge "$((MAX_ITERATIONS - 1))" ]; then
    prompt+="**WARNING: This is one of your final iterations. Prioritize completing your most critical remaining tasks and ensure your progress file is up to date.**\n\n"
  fi

  echo -e "$prompt"
}

# --- Ralph Loop ---
log "INFO" "Starting Ralph Loop for agent: $AGENT (max $MAX_ITERATIONS iterations, model: $MODEL)"

init_progress_dir "$WORKDIR"

for ((iteration=1; iteration<=MAX_ITERATIONS; iteration++)); do
  log "INFO" "=== $AGENT: Iteration $iteration/$MAX_ITERATIONS ==="

  # Check if already completed (from a previous iteration)
  if is_agent_completed "$WORKDIR" "$AGENT"; then
    log "INFO" "Agent $AGENT is already COMPLETED. Skipping remaining iterations."
    break
  fi

  # Build the full prompt for this iteration
  prompt=$(build_prompt "$iteration")

  # Save prompt to a temp file (avoids shell escaping issues with large prompts)
  prompt_file=$(mktemp)
  echo -e "$prompt" > "$prompt_file"

  # Run AI agent in headless mode
  log "INFO" "Running $(provider_cli) (iteration $iteration)..."
  mkdir -p "$LOG_DIR"

  set +e
  if [ "$VERBOSE_LOGS" = true ]; then
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "stream-json" true \
      2>&1 | "$PIPELINE_DIR/lib/log-formatter.sh" \
        --provider "$AI_PROVIDER" \
        --raw-log "$LOG_DIR/${AGENT}_iteration_${iteration}.jsonl" \
      | tee -a "$LOG_DIR/${AGENT}_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  else
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "text" false \
      2>&1 | tee -a "$LOG_DIR/${AGENT}_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  fi
  set -e

  # Extract session ID from verbose logs for potential --resume usage
  if [ "$VERBOSE_LOGS" = true ] && [ -f "$LOG_DIR/${AGENT}_iteration_${iteration}.jsonl" ]; then
    session_id=$(provider_extract_session_id "$LOG_DIR/${AGENT}_iteration_${iteration}.jsonl")
    if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
      echo "$session_id" > "$LOG_DIR/${AGENT}_iteration_${iteration}.session"
      log "INFO" "Session ID: $session_id (resume with: $(provider_resume_hint "$session_id"))"
    fi
  fi

  rm -f "$prompt_file"

  if [ $exit_code -ne 0 ]; then
    log "WARN" "$(provider_cli) exited with code $exit_code on iteration $iteration"
  fi

  # Check completion after this iteration
  if is_agent_completed "$WORKDIR" "$AGENT"; then
    log "INFO" "Agent $AGENT marked COMPLETED after iteration $iteration"
    break
  fi

  if [ "$iteration" -eq "$MAX_ITERATIONS" ]; then
    log "WARN" "Agent $AGENT reached max iterations ($MAX_ITERATIONS) without completing"
  fi

  # Interactive pause: let the user review, modify PRD/progress, or skip
  if [ "$INTERACTIVE" = true ] && [ "$iteration" -lt "$MAX_ITERATIONS" ] && [ -t 0 ]; then
    echo "" >&2
    echo "  [$AGENT] Iteration $iteration complete. Status: $(get_agent_status "$WORKDIR" "$AGENT")" >&2
    echo "  Options:" >&2
    echo "    Enter     = continue to next iteration" >&2
    echo "    s + Enter = skip remaining iterations for this agent" >&2
    echo "    q + Enter = abort pipeline" >&2
    if [ "$VERBOSE_LOGS" = true ] && [ -f "$LOG_DIR/${AGENT}_iteration_${iteration}.session" ]; then
      echo "    Resume this session interactively: $(provider_resume_hint "$(cat "$LOG_DIR/${AGENT}_iteration_${iteration}.session")")" >&2
    fi
    echo "" >&2
    read -r user_input
    case "$user_input" in
      s|S|skip)
        log "INFO" "User skipped remaining iterations for agent $AGENT"
        break
        ;;
      q|Q|quit|abort)
        log "INFO" "User aborted pipeline during agent $AGENT"
        exit 1
        ;;
    esac
  fi

  # Brief pause between iterations to avoid rate limiting
  sleep 2
done

# --- Final Status ---
final_status=$(get_agent_status "$WORKDIR" "$AGENT")
log "INFO" "Agent $AGENT finished with status: $final_status"

if [ "$final_status" = "COMPLETED" ]; then
  exit 0
else
  exit 1
fi
