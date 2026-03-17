#!/bin/bash
set -euo pipefail

# =============================================================================
# generate-prd.sh — PRD and manifest generator
# =============================================================================
# Reads a project brief and repository contexts, then uses Claude Code to
# decompose the work into ordered PRDs and produce a pipeline manifest.
#
# When run without --brief, opens $EDITOR so you can describe your project
# interactively (like git commit).
#
# Usage:
#   # Interactive — opens your editor to write the brief
#   ./pipeline/generate-prd.sh \
#     --output ./prds/my-app \
#     --manifest ./manifests/my-app.json \
#     --repo https://github.com/org/my-app --context ./contexts/my-app
#
#   # From a file — skips the editor
#   ./pipeline/generate-prd.sh \
#     --brief ./briefs/my-app.md \
#     --output ./prds/my-app \
#     --manifest ./manifests/my-app.json \
#     --repo https://github.com/org/my-app --context ./contexts/my-app
#
# Examples:
#   # Interactive, multi-repo
#   ./pipeline/generate-prd.sh \
#     --output ./prds/platform \
#     --manifest ./manifests/platform.json \
#     --name "Platform Rebuild" \
#     --repo https://github.com/org/api --context ./contexts/api \
#     --repo https://github.com/org/web --context ./contexts/web --branch develop
#
#   # Non-interactive with a pre-written brief
#   ./pipeline/generate-prd.sh \
#     --brief ./briefs/platform.md \
#     --output ./prds/platform \
#     --manifest ./manifests/platform.json \
#     --repo https://github.com/org/api --context ./contexts/api

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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
BRIEF_FILE=""
OUTPUT_DIR=""
MANIFEST_PATH=""
PROJECT_NAME=""
AUTHOR=""
MODEL="${CLAUDE_MODEL:-sonnet}"
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-5}"
ALLOWED_TOOLS="${CLAUDE_ALLOWED_TOOLS:-Edit,Write,Bash,Read,MultiEdit}"

REPO_URLS=()
REPO_CONTEXTS=()
REPO_BRANCHES=()
CURRENT_REPO_IDX=-1

while [[ $# -gt 0 ]]; do
  case $1 in
    --brief) BRIEF_FILE="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --manifest) MANIFEST_PATH="$2"; shift 2 ;;
    --name) PROJECT_NAME="$2"; shift 2 ;;
    --author) AUTHOR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
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
Usage: generate-prd.sh --output <dir> --manifest <path> [--brief <file>] --repo <url> [options]

Generates ordered PRDs and a pipeline manifest using Claude Code.

When --brief is omitted, opens your $EDITOR so you can describe what you want
to build interactively (like git commit). Save and close the editor to continue.

Required:
  --output <dir>          Directory to write generated PRD files to
  --manifest <path>       Path to write the manifest JSON file to

Brief (pick one):
  (omit --brief)          Opens $EDITOR with a template for you to fill in
  --brief <file>          Use a pre-written brief file (skips editor)

Repository specification (repeat for each repo):
  --repo <url>            Repository URL (starts a new repo entry)
  --context <path>        Context directory or file for the preceding --repo
  --branch <name>         Base branch for the preceding --repo (default: main)

Options:
  --name <text>           Project name (default: derived from brief or output dir)
  --author <slug>         Author slug for PRD metadata and branch names
                          (default: from git config user.name)
  --model <name>          Claude model to use (default: sonnet)
  --max-iterations <n>    Max Ralph Loop iterations (default: 5)

  -h, --help              Show this help

Examples:
  # Interactive — opens editor to write brief
  ./pipeline/generate-prd.sh \
    --output ./prds/my-app \
    --manifest ./manifests/my-app.json \
    --repo https://github.com/org/my-app \
    --context ./contexts/my-app

  # Non-interactive — use a pre-written brief
  ./pipeline/generate-prd.sh \
    --brief ./briefs/my-app.md \
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

# --- Interactive brief (open editor when --brief is omitted) ---
BRIEF_CLEANUP=""

if [ -z "$BRIEF_FILE" ]; then
  if [ ! -t 0 ]; then
    log "ERROR" "No --brief provided and stdin is not a terminal. Use --brief <file> in non-interactive mode."
    exit 1
  fi

  EDITOR="${VISUAL:-${EDITOR:-vi}}"
  BRIEF_TEMPLATE="$ROOT_DIR/templates/brief.md"
  BRIEF_TMPFILE=$(mktemp "${TMPDIR:-/tmp}/brief-XXXXXX.md")
  BRIEF_CLEANUP="$BRIEF_TMPFILE"

  if [ -f "$BRIEF_TEMPLATE" ]; then
    cp "$BRIEF_TEMPLATE" "$BRIEF_TMPFILE"
  else
    cat > "$BRIEF_TMPFILE" <<'TMPL'
# Project Name

## What I Want to Build

Describe what you want to build here. Be as detailed or high-level as you
like — the PRD generator will decompose this into structured PRDs.

## Key Features

- Feature 1
- Feature 2

## Constraints & Preferences

- Any technical constraints or preferences

## Out of Scope

- What you don't want included
TMPL
  fi

  echo ""
  echo "  Opening $EDITOR to write your project brief..."
  echo "  Fill in the template, save, and close the editor to continue."
  echo "  (To abort, leave the file unchanged or empty.)"
  echo ""

  BRIEF_CHECKSUM_BEFORE=$(md5 -q "$BRIEF_TMPFILE" 2>/dev/null || md5sum "$BRIEF_TMPFILE" | cut -d' ' -f1)

  "$EDITOR" "$BRIEF_TMPFILE"

  BRIEF_CHECKSUM_AFTER=$(md5 -q "$BRIEF_TMPFILE" 2>/dev/null || md5sum "$BRIEF_TMPFILE" | cut -d' ' -f1)

  if [ "$BRIEF_CHECKSUM_BEFORE" = "$BRIEF_CHECKSUM_AFTER" ]; then
    log "ERROR" "Brief was not modified. Aborting."
    rm -f "$BRIEF_TMPFILE"
    exit 1
  fi

  BRIEF_CONTENT_LENGTH=$(wc -c < "$BRIEF_TMPFILE" | tr -d ' ')
  if [ "$BRIEF_CONTENT_LENGTH" -eq 0 ]; then
    log "ERROR" "Brief is empty. Aborting."
    rm -f "$BRIEF_TMPFILE"
    exit 1
  fi

  BRIEF_FILE="$BRIEF_TMPFILE"
  log "INFO" "Brief written via editor ($BRIEF_CONTENT_LENGTH bytes)"
else
  if [ ! -f "$BRIEF_FILE" ]; then
    log "ERROR" "Brief file not found: $BRIEF_FILE"
    exit 1
  fi
fi

# --- Resolve defaults ---
if [ -z "$AUTHOR" ]; then
  AUTHOR=$(git config user.name 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr ' ' '-' || echo "agent")
fi

if [ -z "$PROJECT_NAME" ]; then
  if [ -n "$BRIEF_CLEANUP" ]; then
    PROJECT_NAME=$(basename "$OUTPUT_DIR" | tr '-' ' ' | tr '_' ' ')
  else
    PROJECT_NAME=$(basename "$BRIEF_FILE" .md | tr '-' ' ' | tr '_' ' ')
  fi
fi

# --- Resolve paths ---
BRIEF_FILE=$(realpath "$BRIEF_FILE")

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
if ! command -v claude &> /dev/null; then
  log "ERROR" "Claude Code CLI is required. Install from: https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

# --- Display config ---
log "INFO" "========================================="
log "INFO" "  PRD & Manifest Generator"
log "INFO" "========================================="
log "INFO" "Brief:      $BRIEF_FILE"
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
  log "INFO" "Repos:      (to be read from brief)"
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

  # Project brief
  prompt+="# Project Brief\n\n"
  prompt+="$(cat "$BRIEF_FILE")\n\n"

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
        prompt+="- **Context path (for manifest)**: ./$rel_ctx\n"

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
  prompt+="# Output Configuration\n\n"
  prompt+="- **PRD output directory**: \`$OUTPUT_DIR\`\n"
  prompt+="- **Manifest output path**: \`$MANIFEST_PATH\`\n"
  prompt+="- **Author slug**: \`$AUTHOR\`\n"
  prompt+="- **Project name**: \`$PROJECT_NAME\`\n"
  prompt+="- **Today's date**: $(date '+%Y-%m-%d')\n\n"

  prompt+="Write each PRD as a separate markdown file in the output directory.\n"
  prompt+="Write the manifest JSON to the manifest output path.\n\n"

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

  log "INFO" "Running Claude Code (iteration $iteration)..."

  set +e
  claude -p "$(cat "$prompt_file")" \
    --model "$MODEL" \
    --allowedTools "$ALLOWED_TOOLS" \
    --dangerously-skip-permissions \
    --output-format text \
    2>&1 | tee -a "$LOG_DIR/prd_generator_iteration_${iteration}.log"
  exit_code=$?
  set -e

  rm -f "$prompt_file"

  if [ $exit_code -ne 0 ]; then
    log "WARN" "Claude Code exited with code $exit_code on iteration $iteration"
  fi

  if is_agent_completed "$ROOT_DIR" "prd-generator"; then
    log "INFO" "PRD generator marked COMPLETED after iteration $iteration"
    break
  fi

  if [ "$iteration" -eq "$MAX_ITERATIONS" ]; then
    log "WARN" "PRD generator reached max iterations ($MAX_ITERATIONS) without completing"
  fi

  sleep 2
done

# --- Cleanup ---
rm -rf "$ROOT_DIR/.agent-progress" 2>/dev/null || true
if [ -n "$BRIEF_CLEANUP" ]; then
  rm -f "$BRIEF_CLEANUP"
fi

# --- Summary ---
prd_count=$(find "$OUTPUT_DIR" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')

log "INFO" ""
log "INFO" "========================================="
log "INFO" "  PRD Generation Complete"
log "INFO" "========================================="
log "INFO" "Output:     $OUTPUT_DIR"
log "INFO" "PRDs:       $prd_count file(s)"
log "INFO" "Manifest:   $MANIFEST_PATH"
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
  log "INFO" "Manifest written to: $MANIFEST_PATH"
else
  log "WARN" "Manifest was not generated. Check the logs at: $LOG_DIR/"
fi

log "INFO" ""
log "INFO" "Next steps:"
log "INFO" "  1. Review the generated PRDs in $OUTPUT_DIR"
log "INFO" "  2. Review the manifest at $MANIFEST_PATH"
log "INFO" "  3. Run the pipeline: ./pipeline/orchestrator.sh --manifest $MANIFEST_PATH"
log "INFO" "========================================="

if [ "$prd_count" -eq 0 ]; then
  exit 1
fi
