#!/bin/bash
set -euo pipefail

# =============================================================================
# generate-context.sh — Context skill generator
# =============================================================================
# Analyzes a repository and generates context skill files that teach AI agents
# about the project's stack, architecture, and conventions.
#
# Usage:
#   ./pipeline/generate-context.sh \
#     --repo <path-or-github-url> \
#     --output <directory> \
#     [--model <model-name>] \
#     [--max-iterations <n>] \
#     [--quiet]
#
# Examples:
#   # Generate skills from a local repo
#   ./pipeline/generate-context.sh --repo /path/to/my-repo --output ./contexts/my-repo
#
#   # Generate skills from a GitHub repo (cloned to temp dir)
#   ./pipeline/generate-context.sh --repo https://github.com/org/repo --output ./contexts/repo
#
#   # Update existing skills (re-analyzes and overwrites)
#   ./pipeline/generate-context.sh --repo /path/to/my-repo --output ./contexts/my-repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/lib/provider.sh"
source "$SCRIPT_DIR/lib/validation.sh"
source "$SCRIPT_DIR/lib/progress.sh"

# --- Load .env if present ---
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

# --- Logging ---
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
mkdir -p "$LOG_DIR"

log() {
  local level="$1"
  local msg="$2"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $msg" >&2
  echo "[$timestamp] [$level] $msg" >> "$LOG_DIR/generate-context.log"
}

# --- Argument Parsing ---
REPO_PATH=""
OUTPUT_DIR=""
MODEL="$(provider_default_model)"
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-5}"
WORK_DIR="${PIPELINE_WORK_DIR:-/tmp/coding-agents-work}"
ALLOWED_TOOLS="$(provider_default_allowed_tools)"
QUIET=false
VERBOSE_LOGS="${VERBOSE_LOGS:-false}"
INTERACTIVE="${INTERACTIVE:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --repo) REPO_PATH="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --workdir) WORK_DIR="$2"; shift 2 ;;
    --quiet) QUIET=true; shift ;;
    --verbose-logs) VERBOSE_LOGS=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: generate-context.sh --repo <path-or-url> --output <dir> [options]

Analyzes a repository and generates context skill files for the agent pipeline.

Arguments:
  --repo <path-or-url>    Local path or GitHub URL of the repository to analyze
  --output <dir>          Directory to write context skill files to (e.g., ./contexts/my-repo)

Options:
  --model <name>          AI model to use (default depends on AI_PROVIDER)
  --max-iterations <n>    Max Ralph Loop iterations (default: 5)
  --workdir <path>        Working directory for cloned repos (default: /tmp/coding-agents-work)
  --quiet                 Suppress streaming output (only show summary)
  --verbose-logs          Explicit verbose mode (default when not --quiet)
  --interactive           Pause between iterations for review and course correction

  -h, --help              Show this help

Examples:
  # Local repo
  ./pipeline/generate-context.sh \
    --repo ~/projects/my-app \
    --output ./contexts/my-app

  # GitHub repo
  ./pipeline/generate-context.sh \
    --repo https://github.com/org/my-app \
    --output ./contexts/my-app

  # With a specific model
  ./pipeline/generate-context.sh \
    --repo ~/projects/my-app \
    --output ./contexts/my-app \
    --model opus
HELP
      exit 0
      ;;
    *) log "ERROR" "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$REPO_PATH" ] || [ -z "$OUTPUT_DIR" ]; then
  log "ERROR" "Both --repo and --output are required. Use --help for usage."
  exit 1
fi

# --- Resolve Paths (must be absolute before we cd later) ---
AGENTS_DIR="$ROOT_DIR/agents"
AGENT_PROMPT_FILE="$AGENTS_DIR/context-generator/prompt.md"
LOG_FORMATTER="$SCRIPT_DIR/lib/log-formatter.sh"

if [ ! -f "$AGENT_PROMPT_FILE" ]; then
  log "ERROR" "Context generator prompt not found: $AGENT_PROMPT_FILE"
  exit 1
fi

# Resolve output dir to absolute path before cd
if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(realpath "$OUTPUT_DIR")

# Resolve log dir to absolute
if [[ "$LOG_DIR" != /* ]]; then
  LOG_DIR="$(pwd)/$LOG_DIR"
fi

# --- Prepare Repository ---
REPO_WORKDIR=""

if [[ "$REPO_PATH" == https://* ]] || [[ "$REPO_PATH" == git@* ]]; then
  REPO_NAME=$(basename "$REPO_PATH" .git)
  REPO_WORKDIR="$WORK_DIR/context-gen-$REPO_NAME"

  log "INFO" "Cloning $REPO_PATH → $REPO_WORKDIR"
  if [ -d "$REPO_WORKDIR/.git" ]; then
    git -C "$REPO_WORKDIR" fetch --all 2>/dev/null || true
    git -C "$REPO_WORKDIR" pull 2>/dev/null || true
  else
    rm -rf "$REPO_WORKDIR"
    git clone --depth 50 "$REPO_PATH" "$REPO_WORKDIR"
  fi
elif [ -d "$REPO_PATH" ]; then
  REPO_WORKDIR=$(realpath "$REPO_PATH")
  log "INFO" "Using local repository: $REPO_WORKDIR"
else
  log "ERROR" "Repository not found: $REPO_PATH"
  exit 1
fi

log "INFO" "========================================="
log "INFO" "  Context Skill Generator"
log "INFO" "========================================="
log "INFO" "Repository:  $REPO_WORKDIR"
log "INFO" "Output:      $OUTPUT_DIR"
log "INFO" "Model:       $MODEL"
log "INFO" "Iterations:  $MAX_ITERATIONS"
log "INFO" "========================================="

# --- Validate ---
if ! provider_validate_cli; then
  exit 1
fi

# --- Build Prompt ---
build_prompt() {
  local iteration="$1"
  local prompt=""

  # Agent prompt
  prompt+="$(cat "$AGENT_PROMPT_FILE")\n\n"

  # Output instructions
  prompt+="# Output Configuration\n\n"
  prompt+="Write all context skill files to this directory: \`$OUTPUT_DIR\`\n\n"
  prompt+="The repository to analyze is at: \`$REPO_WORKDIR\`\n\n"
  if [[ "$REPO_PATH" == https://* ]] || [[ "$REPO_PATH" == git@* ]]; then
    prompt+="The repository URL is: $REPO_PATH — use this as the **Repository** value in overview.md (not the local clone path).\n\n"
  fi
  prompt+="Create a progress file at \`$REPO_WORKDIR/.agent-progress/context-generator.md\` to track your work.\n\n"

  # Iteration context
  prompt+="# Iteration Context\n\n"
  prompt+="This is iteration $iteration of $MAX_ITERATIONS.\n\n"

  # Progress from previous iterations
  local own_progress="$REPO_WORKDIR/.agent-progress/context-generator.md"
  if [ -f "$own_progress" ]; then
    prompt+="# Your Progress from Previous Iterations\n\n"
    prompt+="$(cat "$own_progress")\n\n"
    prompt+="Continue where you left off. Check what's already done and work on the next incomplete task.\n\n"
  fi

  if [ "$iteration" -ge "$((MAX_ITERATIONS - 1))" ]; then
    prompt+="**WARNING: This is one of your final iterations. Prioritize completing your most critical remaining tasks and ensure your progress file is up to date.**\n\n"
  fi

  echo -e "$prompt"
}

# --- Change to the target repo (Claude Code uses cwd as workspace) ---
cd "$REPO_WORKDIR"

# --- Ralph Loop ---
init_progress_dir "$REPO_WORKDIR"

for ((iteration=1; iteration<=MAX_ITERATIONS; iteration++)); do
  log "INFO" "=== Context Generator: Iteration $iteration/$MAX_ITERATIONS ==="

  if is_agent_completed "$REPO_WORKDIR" "context-generator"; then
    log "INFO" "Context generator already COMPLETED. Skipping remaining iterations."
    break
  fi

  prompt=$(build_prompt "$iteration")

  prompt_file=$(mktemp)
  echo -e "$prompt" > "$prompt_file"

  log "INFO" "Running $(provider_cli) (iteration $iteration)..."

  set +e
  if [ "$QUIET" = true ]; then
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "text" false \
      2>&1 | tee -a "$LOG_DIR/context_generator_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  else
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "stream-json" true \
      2>&1 | "$LOG_FORMATTER" \
        --provider "$AI_PROVIDER" \
        --raw-log "$LOG_DIR/context_generator_iteration_${iteration}.jsonl" \
      | tee -a "$LOG_DIR/context_generator_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  fi
  set -e

  # Extract session ID from verbose logs for potential --resume usage
  if [ "$QUIET" != true ] && [ -f "$LOG_DIR/context_generator_iteration_${iteration}.jsonl" ]; then
    session_id=$(provider_extract_session_id "$LOG_DIR/context_generator_iteration_${iteration}.jsonl")
    if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
      echo "$session_id" > "$LOG_DIR/context_generator_iteration_${iteration}.session"
      log "INFO" "Session ID: $session_id (resume with: $(provider_resume_hint "$session_id"))"
    fi
  fi

  rm -f "$prompt_file"

  if [ $exit_code -ne 0 ]; then
    log "WARN" "$(provider_cli) exited with code $exit_code on iteration $iteration"
  fi

  if is_agent_completed "$REPO_WORKDIR" "context-generator"; then
    log "INFO" "Context generator marked COMPLETED after iteration $iteration"
    break
  fi

  if [ "$iteration" -eq "$MAX_ITERATIONS" ]; then
    log "WARN" "Context generator reached max iterations ($MAX_ITERATIONS) without completing"
  fi

  # Interactive pause between iterations
  if [ "$INTERACTIVE" = true ] && [ "$iteration" -lt "$MAX_ITERATIONS" ] && [ -t 0 ]; then
    echo "" >&2
    echo "  [context-generator] Iteration $iteration complete." >&2
    echo "  Options:" >&2
    echo "    Enter     = continue to next iteration" >&2
    echo "    s + Enter = skip remaining iterations" >&2
    echo "    q + Enter = abort" >&2
    if [ "$QUIET" != true ] && [ -f "$LOG_DIR/context_generator_iteration_${iteration}.session" ]; then
      echo "    Resume this session interactively: $(provider_resume_hint "$(cat "$LOG_DIR/context_generator_iteration_${iteration}.session")")" >&2
    fi
    echo "" >&2
    read -r user_input
    case "$user_input" in
      s|S|skip)
        log "INFO" "User skipped remaining iterations for context generator"
        break
        ;;
      q|Q|quit|abort)
        log "INFO" "User aborted context generation"
        exit 1
        ;;
    esac
  fi

  sleep 2
done

# --- Cleanup ---
rm -rf "$REPO_WORKDIR/.agent-progress" 2>/dev/null || true

# --- Summary ---
skill_count=$(find "$OUTPUT_DIR" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')

log "INFO" ""
log "INFO" "========================================="
log "INFO" "  Context Generation Complete"
log "INFO" "========================================="
log "INFO" "Output:     $OUTPUT_DIR"
log "INFO" "Skills:     $skill_count file(s)"
log "INFO" ""

if [ "$skill_count" -gt 0 ]; then
  log "INFO" "Generated skills:"
  for file in "$OUTPUT_DIR"/*.md; do
    if [ -f "$file" ]; then
      log "INFO" "  - $(basename "$file")"
    fi
  done
else
  log "WARN" "No skill files were generated. Check the logs at: $LOG_DIR/"
fi

log "INFO" ""
log "INFO" "Next steps:"
log "INFO" "  1. Review the generated skills in $OUTPUT_DIR"
log "INFO" "  2. Use in a manifest: \"context\": \"$OUTPUT_DIR\""
log "INFO" "  3. Generate PRDs: ca generate prd --output ./prds/app --manifest ./manifests/app.json --repo <url> --context $OUTPUT_DIR"
log "INFO" "========================================="

if [ "$skill_count" -eq 0 ]; then
  exit 1
fi
