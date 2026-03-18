#!/bin/bash
set -euo pipefail

# =============================================================================
# generate-prd.sh — PRD and manifest generator
# =============================================================================
# Prompts you to describe what you want built, then uses Claude Code with
# repository contexts to decompose the work into ordered PRDs and a manifest.
#
# Usage:
#   ./pipeline/generate-prd.sh \
#     --output ./prds/my-app \
#     --manifest ./manifests/my-app.json \
#     --repo https://github.com/org/my-app --context ./contexts/my-app
#
# Examples:
#   # Multi-repo
#   ./pipeline/generate-prd.sh \
#     --output ./prds/platform \
#     --manifest ./manifests/platform.json \
#     --name "Platform Rebuild" \
#     --repo https://github.com/org/api --context ./contexts/api \
#     --repo https://github.com/org/web --context ./contexts/web --branch develop

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/lib/provider.sh"
source "$SCRIPT_DIR/lib/validation.sh"
source "$SCRIPT_DIR/lib/progress.sh"
source "$SCRIPT_DIR/lib/context.sh"

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
  echo "[$timestamp] [$level] $msg" >> "$LOG_DIR/generate-prd.log"
}

# --- Argument Parsing ---
OUTPUT_DIR=""
MANIFEST_PATH=""
PROJECT_NAME=""
AUTHOR=""
MODEL="$(provider_default_model)"
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-5}"
ALLOWED_TOOLS="$(provider_default_allowed_tools)"
QUIET=false
INTERACTIVE="${INTERACTIVE:-false}"

REPO_URLS=()
REPO_CONTEXTS=()
REPO_BRANCHES=()
CURRENT_REPO_IDX=-1

while [[ $# -gt 0 ]]; do
  case $1 in
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --manifest) MANIFEST_PATH="$2"; shift 2 ;;
    --name) PROJECT_NAME="$2"; shift 2 ;;
    --author) AUTHOR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --verbose-logs) shift ;;
    --quiet) QUIET=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    --repo)
      CURRENT_REPO_IDX=$((CURRENT_REPO_IDX + 1))
      REPO_URLS[$CURRENT_REPO_IDX]="$2"
      REPO_CONTEXTS[$CURRENT_REPO_IDX]=""
      REPO_BRANCHES[$CURRENT_REPO_IDX]="main"
      shift 2
      ;;
    --context)
      if [ $CURRENT_REPO_IDX -lt 0 ]; then
        log "ERROR" "--context must come after --repo"
        exit 1
      fi
      REPO_CONTEXTS[$CURRENT_REPO_IDX]="$2"
      shift 2
      ;;
    --branch)
      if [ $CURRENT_REPO_IDX -lt 0 ]; then
        log "ERROR" "--branch must come after --repo"
        exit 1
      fi
      REPO_BRANCHES[$CURRENT_REPO_IDX]="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'HELP'
Usage: generate-prd.sh --output <dir> --manifest <path> --repo <url> [options]

Generates ordered PRDs and a pipeline manifest using Claude Code.
Prompts you to describe what you want built. Type your tasks and press Enter
twice (empty line) to submit.

Required:
  --output <dir>          Directory to write generated PRD files to
  --manifest <path>       Path to write the manifest JSON file to

Repository specification (repeat for each repo):
  --repo <url>            Repository URL (starts a new repo entry)
  --context <path>        Context directory or file for the preceding --repo
  --branch <name>         Base branch for the preceding --repo (default: main)

Options:
  --name <text>           Project name (default: derived from output dir name)
  --author <slug>         Author slug for PRD metadata and branch names
                          (default: from git config user.name)
  --model <name>          AI model to use (default depends on AI_PROVIDER)
  --max-iterations <n>    Max Ralph Loop iterations (default: 5)
  --quiet                 Suppress detailed streaming output (use text mode)
  --interactive           Pause between iterations for review and course correction

  -h, --help              Show this help

Examples:
  # Single repo
  ./pipeline/generate-prd.sh \
    --output ./prds/my-app \
    --manifest ./manifests/my-app.json \
    --repo https://github.com/org/my-app \
    --context ./contexts/my-app

  # Multi-repo with custom settings
  ./pipeline/generate-prd.sh \
    --output ./prds/platform \
    --manifest ./manifests/platform.json \
    --name "Platform Rebuild" \
    --author delehner \
    --repo https://github.com/org/api --context ./contexts/api \
    --repo https://github.com/org/web --context ./contexts/web --branch develop
HELP
      exit 0
      ;;
    *) log "ERROR" "Unknown argument: $1"; exit 1 ;;
  esac
done

# --- Validate required args ---
if [ -z "$OUTPUT_DIR" ]; then
  log "ERROR" "--output is required. Use --help for usage."
  exit 1
fi

if [ -z "$MANIFEST_PATH" ]; then
  log "ERROR" "--manifest is required. Use --help for usage."
  exit 1
fi

# --- Prompt user for project description ---
if [ ! -t 0 ]; then
  log "ERROR" "stdin is not a terminal. This script requires interactive input."
  exit 1
fi

INPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/prd-input-XXXXXX.md")

echo ""
echo "  What do you want to build?"
echo "  Describe your tasks below. Press Enter twice (empty line) to submit."
echo ""

INPUT_CONTENT=""
EMPTY_LINES=0

while true; do
  printf "  > "
  IFS= read -r line || break
  if [ -z "$line" ]; then
    EMPTY_LINES=$((EMPTY_LINES + 1))
    if [ "$EMPTY_LINES" -ge 1 ]; then
      break
    fi
  else
    EMPTY_LINES=0
    if [ -n "$INPUT_CONTENT" ]; then
      INPUT_CONTENT="${INPUT_CONTENT}
${line}"
    else
      INPUT_CONTENT="$line"
    fi
  fi
done

echo ""

if [ -z "$INPUT_CONTENT" ]; then
  log "ERROR" "No tasks provided. Aborting."
  rm -f "$INPUT_FILE"
  exit 1
fi

echo "$INPUT_CONTENT" > "$INPUT_FILE"

INPUT_LENGTH=$(wc -c < "$INPUT_FILE" | tr -d ' ')
log "INFO" "Description captured ($INPUT_LENGTH bytes)"

# --- Resolve defaults ---
if [ -z "$AUTHOR" ]; then
  AUTHOR=$(git config user.name 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr ' ' '-' || echo "agent")
fi

if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME=$(basename "$OUTPUT_DIR" | tr '-' ' ' | tr '_' ' ')
fi

# --- Resolve paths ---

if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$(pwd)/$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(realpath "$OUTPUT_DIR")

MANIFEST_DIR=$(dirname "$MANIFEST_PATH")
if [[ "$MANIFEST_DIR" != /* ]]; then
  MANIFEST_DIR="$(pwd)/$MANIFEST_DIR"
fi
mkdir -p "$MANIFEST_DIR"
if [[ "$MANIFEST_PATH" != /* ]]; then
  MANIFEST_PATH="$(pwd)/$MANIFEST_PATH"
fi

AGENTS_DIR="$ROOT_DIR/agents"
AGENT_PROMPT_FILE="$AGENTS_DIR/prd-generator/prompt.md"
PRD_TEMPLATE_FILE="$ROOT_DIR/templates/prd.md"
LOG_FORMATTER="$SCRIPT_DIR/lib/log-formatter.sh"

if [ ! -f "$AGENT_PROMPT_FILE" ]; then
  log "ERROR" "PRD generator prompt not found: $AGENT_PROMPT_FILE"
  exit 1
fi

# --- Resolve repo contexts to absolute paths ---
for i in "${!REPO_CONTEXTS[@]}"; do
  ctx="${REPO_CONTEXTS[$i]}"
  if [ -n "$ctx" ]; then
    if [[ "$ctx" != /* ]]; then
      ctx="$(pwd)/$ctx"
    fi
    if [ -d "$ctx" ] || [ -f "$ctx" ]; then
      REPO_CONTEXTS[$i]=$(realpath "$ctx")
    else
      log "WARN" "Context not found: $ctx (for repo ${REPO_URLS[$i]})"
      REPO_CONTEXTS[$i]=""
    fi
  fi
done

# --- Validate ---
if ! provider_validate_cli; then
  exit 1
fi

# --- Display config ---
log "INFO" "========================================="
log "INFO" "  PRD & Manifest Generator"
log "INFO" "========================================="
log "INFO" "Project:    $PROJECT_NAME"
log "INFO" "Author:     $AUTHOR"
log "INFO" "Output:     $OUTPUT_DIR"
log "INFO" "Manifest:   $MANIFEST_PATH"
log "INFO" "Model:      $MODEL"
log "INFO" "Iterations: $MAX_ITERATIONS"
if [ ${#REPO_URLS[@]} -gt 0 ]; then
  log "INFO" "Repos:      ${#REPO_URLS[@]}"
  for i in "${!REPO_URLS[@]}"; do
    local_ctx=""
    if [ -n "${REPO_CONTEXTS[$i]:-}" ]; then
      local_ctx=" (context: ${REPO_CONTEXTS[$i]})"
    fi
    log "INFO" "  [$((i+1))] ${REPO_URLS[$i]} @ ${REPO_BRANCHES[$i]}$local_ctx"
  done
else
  log "INFO" "Repos:      (to be inferred from description)"
fi
log "INFO" "========================================="

# --- Build Prompt ---
build_prompt() {
  local iteration="$1"
  local prompt=""

  # Agent prompt
  prompt+="$(cat "$AGENT_PROMPT_FILE")\n\n"

  # PRD template reference
  prompt+="# PRD Template Reference\n\n"
  prompt+="Use this template as the structural guide for every PRD you generate:\n\n"
  prompt+="\`\`\`markdown\n$(cat "$PRD_TEMPLATE_FILE")\n\`\`\`\n\n"

  # Project description (user input)
  prompt+="# Project Description\n\n"
  prompt+="$(cat "$INPUT_FILE")\n\n"

  # Repository information
  if [ ${#REPO_URLS[@]} -gt 0 ]; then
    prompt+="# Target Repositories\n\n"
    for i in "${!REPO_URLS[@]}"; do
      local repo_name
      repo_name=$(basename "${REPO_URLS[$i]}" .git)
      prompt+="## Repository: $repo_name\n\n"
      prompt+="- **URL**: ${REPO_URLS[$i]}\n"
      prompt+="- **Branch**: ${REPO_BRANCHES[$i]}\n"

      local ctx="${REPO_CONTEXTS[$i]:-}"
      if [ -n "$ctx" ]; then
        # Compute the context path relative to the manifest for the manifest JSON
        local manifest_dir_real
        manifest_dir_real=$(realpath "$MANIFEST_DIR")
        # Use Python for portable relpath (works on macOS bash 3.2)
        local rel_ctx
        rel_ctx=$(python3 -c "import os.path; print(os.path.relpath('$ctx', '$manifest_dir_real'))")
        prompt+="- **Context path (for manifest)**: $rel_ctx\n"

        prompt+="\n### Context for $repo_name\n\n"
        if [ -d "$ctx" ]; then
          # Assemble context skills into a single block
          local temp_ctx
          temp_ctx=$(mktemp)
          assemble_context_skills "$ctx" "$temp_ctx"
          prompt+="$(cat "$temp_ctx")\n\n"
          rm -f "$temp_ctx"
        elif [ -f "$ctx" ]; then
          prompt+="$(cat "$ctx")\n\n"
        fi
      fi
    done
  fi

  # Output instructions
  local manifest_dir_real
  manifest_dir_real=$(realpath "$MANIFEST_DIR")
  local rel_prd_dir
  rel_prd_dir=$(python3 -c "import os.path; print(os.path.relpath('$OUTPUT_DIR', '$manifest_dir_real'))")

  prompt+="# Output Configuration\n\n"
  prompt+="- **PRD output directory**: \`$OUTPUT_DIR\`\n"
  prompt+="- **PRD directory relative to manifest**: \`$rel_prd_dir\`\n"
  prompt+="- **Manifest output path**: \`$MANIFEST_PATH\`\n"
  prompt+="- **Author slug**: \`$AUTHOR\`\n"
  prompt+="- **Project name**: \`$PROJECT_NAME\`\n"
  prompt+="- **Today's date**: $(date '+%Y-%m-%d')\n\n"

  prompt+="Write each PRD as a separate markdown file in the output directory.\n"
  prompt+="Write the manifest JSON to the manifest output path.\n"
  prompt+="In the manifest, PRD paths MUST be relative to the manifest file's directory. Use the relative PRD directory above to construct them (e.g. \`$rel_prd_dir/01-slug.md\`).\n\n"

  if [ ${#REPO_URLS[@]} -gt 0 ]; then
    prompt+="Use these exact repository URLs and branches in the manifest. "
    prompt+="Use the context paths noted above (relative to the manifest directory) in the manifest.\n\n"
  fi

  prompt+="Create a progress file at \`$ROOT_DIR/.agent-progress/prd-generator.md\` to track your work.\n\n"

  # Iteration context
  prompt+="# Iteration Context\n\n"
  prompt+="This is iteration $iteration of $MAX_ITERATIONS.\n\n"

  # Progress from previous iterations
  local own_progress="$ROOT_DIR/.agent-progress/prd-generator.md"
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

# --- Ralph Loop ---
init_progress_dir "$ROOT_DIR"

for ((iteration=1; iteration<=MAX_ITERATIONS; iteration++)); do
  log "INFO" "=== PRD Generator: Iteration $iteration/$MAX_ITERATIONS ==="

  if is_agent_completed "$ROOT_DIR" "prd-generator"; then
    log "INFO" "PRD generator already COMPLETED. Skipping remaining iterations."
    break
  fi

  prompt=$(build_prompt "$iteration")

  prompt_file=$(mktemp)
  echo -e "$prompt" > "$prompt_file"

  log "INFO" "Running $(provider_cli) (iteration $iteration)..."

  set +e
  if [ "$QUIET" = true ]; then
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "text" false \
      2>&1 | tee -a "$LOG_DIR/prd_generator_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  else
    provider_run "$prompt_file" "$MODEL" "$ALLOWED_TOOLS" "stream-json" true \
      2>&1 | "$LOG_FORMATTER" \
        --provider "$AI_PROVIDER" \
        --raw-log "$LOG_DIR/prd_generator_iteration_${iteration}.jsonl" \
      | tee -a "$LOG_DIR/prd_generator_iteration_${iteration}.log"
    exit_code=${PIPESTATUS[0]}
  fi
  set -e

  # Extract session ID from verbose logs for potential --resume usage
  if [ "$QUIET" != true ] && [ -f "$LOG_DIR/prd_generator_iteration_${iteration}.jsonl" ]; then
    session_id=$(provider_extract_session_id "$LOG_DIR/prd_generator_iteration_${iteration}.jsonl")
    if [ -n "$session_id" ] && [ "$session_id" != "null" ]; then
      echo "$session_id" > "$LOG_DIR/prd_generator_iteration_${iteration}.session"
      log "INFO" "Session ID: $session_id (resume with: $(provider_resume_hint "$session_id"))"
    fi
  fi

  rm -f "$prompt_file"

  if [ $exit_code -ne 0 ]; then
    log "WARN" "$(provider_cli) exited with code $exit_code on iteration $iteration"
  fi

  if is_agent_completed "$ROOT_DIR" "prd-generator"; then
    log "INFO" "PRD generator marked COMPLETED after iteration $iteration"
    break
  fi

  if [ "$iteration" -eq "$MAX_ITERATIONS" ]; then
    log "WARN" "PRD generator reached max iterations ($MAX_ITERATIONS) without completing"
  fi

  # Interactive pause between iterations
  if [ "$INTERACTIVE" = true ] && [ "$iteration" -lt "$MAX_ITERATIONS" ] && [ -t 0 ]; then
    echo "" >&2
    echo "  [prd-generator] Iteration $iteration complete." >&2
    echo "  Options:" >&2
    echo "    Enter     = continue to next iteration" >&2
    echo "    s + Enter = skip remaining iterations" >&2
    echo "    q + Enter = abort" >&2
    if [ "$QUIET" != true ] && [ -f "$LOG_DIR/prd_generator_iteration_${iteration}.session" ]; then
      echo "    Resume this session interactively: $(provider_resume_hint "$(cat "$LOG_DIR/prd_generator_iteration_${iteration}.session")")" >&2
    fi
    echo "" >&2
    read -r user_input
    case "$user_input" in
      s|S|skip)
        log "INFO" "User skipped remaining iterations for PRD generator"
        break
        ;;
      q|Q|quit|abort)
        log "INFO" "User aborted PRD generation"
        exit 1
        ;;
    esac
  fi

  sleep 2
done

# --- Cleanup ---
rm -rf "$ROOT_DIR/.agent-progress" 2>/dev/null || true
rm -f "$INPUT_FILE"

# --- Summary ---
prd_count=$(find "$OUTPUT_DIR" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')

DISPLAY_OUTPUT=$(python3 -c "import os.path; print(os.path.relpath('$OUTPUT_DIR'))")
DISPLAY_MANIFEST=$(python3 -c "import os.path; print(os.path.relpath('$MANIFEST_PATH'))")

log "INFO" ""
log "INFO" "========================================="
log "INFO" "  PRD Generation Complete"
log "INFO" "========================================="
log "INFO" "Output:     $DISPLAY_OUTPUT"
log "INFO" "PRDs:       $prd_count file(s)"
log "INFO" "Manifest:   $DISPLAY_MANIFEST"
log "INFO" ""

if [ "$prd_count" -gt 0 ]; then
  log "INFO" "Generated PRDs:"
  for file in "$OUTPUT_DIR"/*.md; do
    if [ -f "$file" ]; then
      log "INFO" "  - $(basename "$file")"
    fi
  done
else
  log "WARN" "No PRD files were generated. Check the logs at: $LOG_DIR/"
fi

if [ -f "$MANIFEST_PATH" ]; then
  log "INFO" ""
  log "INFO" "Manifest written to: $DISPLAY_MANIFEST"
else
  log "WARN" "Manifest was not generated. Check the logs at: $LOG_DIR/"
fi

log "INFO" ""
log "INFO" "Next steps:"
log "INFO" "  1. Review the generated PRDs in $DISPLAY_OUTPUT"
log "INFO" "  2. Review the manifest at $DISPLAY_MANIFEST"
log "INFO" "  3. Run the pipeline: ca orchestrate --manifest $DISPLAY_MANIFEST"
log "INFO" "========================================="

if [ "$prd_count" -eq 0 ]; then
  exit 1
fi
