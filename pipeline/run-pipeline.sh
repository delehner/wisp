#!/bin/bash
set -euo pipefail

# =============================================================================
# run-pipeline.sh — Single PRD × Single Repo pipeline
# =============================================================================
# Runs the full agent sequence for ONE PRD against ONE repository.
# Called by orchestrator.sh for each PRD×repo combination.
# Can also be invoked directly for single runs.
#
# By default, agents run inside a Dev Container for isolation.
# Use --no-devcontainer to run directly on the host.
#
# Usage:
#   ./pipeline/run-pipeline.sh \
#     --prd <path-to-prd> \
#     --repo <github-repo-url> \
#     [--branch <base-branch>] \
#     [--workdir <working-directory>] \
#     [--agents <comma-separated-agent-list>] \
#     [--skip-pr] \
#     [--no-devcontainer] \
#     [--model <model-name>]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/lib/prd-parser.sh"
source "$SCRIPT_DIR/lib/progress.sh"
source "$SCRIPT_DIR/lib/git-utils.sh"
source "$SCRIPT_DIR/lib/provider.sh"
source "$SCRIPT_DIR/lib/validation.sh"
source "$SCRIPT_DIR/lib/context.sh"

# --- Load .env if present ---
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
fi

# --- Logging ---
LOG_LEVEL="${LOG_LEVEL:-info}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
if [[ "$LOG_DIR" != /* ]]; then
  LOG_DIR="$ROOT_DIR/${LOG_DIR#./}"
fi
mkdir -p "$LOG_DIR"

log() {
  local level="$1"
  local msg="$2"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $msg" >&2
  echo "[$timestamp] [$level] $msg" >> "$LOG_DIR/pipeline.log"
}

# --- Argument Parsing ---
PRD_FILE=""
REPO_URL=""
CONTEXT_FILE=""
BASE_BRANCH="${DEFAULT_BASE_BRANCH:-main}"
WORK_DIR="${PIPELINE_WORK_DIR:-/tmp/coding-agents-work}"
AGENTS="architect,designer,migration,developer,accessibility,tester,performance,secops,dependency,infrastructure,devops,rollback,documentation,reviewer"
SKIP_PR=false
MODEL="$(provider_default_model)"
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-10}"
USE_DEVCONTAINER="${USE_DEVCONTAINER:-true}"
EVIDENCE_AGENTS="${EVIDENCE_AGENTS:-tester,performance,secops,dependency,infrastructure,devops}"
STACK_ON=""
PIPELINE_GIT_NAME=""
PIPELINE_GIT_EMAIL=""
VERBOSE_LOGS="${VERBOSE_LOGS:-false}"
INTERACTIVE="${INTERACTIVE:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --prd) PRD_FILE="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --context) CONTEXT_FILE="$2"; shift 2 ;;
    --branch) BASE_BRANCH="$2"; shift 2 ;;
    --workdir) WORK_DIR="$2"; shift 2 ;;
    --agents) AGENTS="$2"; shift 2 ;;
    --stack-on) STACK_ON="$2"; shift 2 ;;
    --skip-pr) SKIP_PR=true; shift ;;
    --no-context-update) UPDATE_PROJECT_CONTEXT=false; shift ;;
    --no-devcontainer) USE_DEVCONTAINER=false; shift ;;
    --model) MODEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --evidence-agents) EVIDENCE_AGENTS="$2"; shift 2 ;;
    --verbose-logs) VERBOSE_LOGS=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: run-pipeline.sh --prd <path> --repo <url> [options]

Options:
  --prd <path>           Path to PRD file (required)
  --repo <url>           GitHub repository URL (required)
  --context <path>       Project context (file or skill directory) injected as CLAUDE.md/GEMINI.md (ephemeral, never committed)
  --branch <name>        Base branch (default: main)
  --workdir <path>       Working directory for cloned repo
  --agents <list>        Comma-separated agent list (default: architect,designer,migration,developer,accessibility,tester,performance,secops,dependency,infrastructure,devops,rollback,documentation,reviewer)
  --stack-on <branch>    Stack this branch on top of another feature branch (for same-repo PRDs).
                            Creates the feature branch from <branch> tip and targets the PR at it.
  --skip-pr              Don't create a PR at the end
  --no-context-update    Don't update project context after agents finish
  --no-devcontainer      Run agents directly on host instead of inside a Dev Container
  --model <name>         AI model to use (default depends on AI_PROVIDER)
  --max-iterations <n>   Max iterations per agent (default: 10)
  --evidence-agents <list>  Comma-separated agents whose reports are posted as PR comments
                            (default: tester,performance,secops,dependency,infrastructure,devops)
  --verbose-logs            Enable detailed logging (thinking, tool use, results via stream-json)
  --interactive             Pause between agents and iterations for review and course correction
HELP
      exit 0
      ;;
    *) log "ERROR" "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$PRD_FILE" ] || [ -z "$REPO_URL" ]; then
  log "ERROR" "Both --prd and --repo are required. Use --help for usage."
  exit 1
fi

# --- Resolve PRD path ---
PRD_FILE=$(realpath "$PRD_FILE")

# --- Validate ---
log "INFO" "========================================="
log "INFO" "  Coding Agents Pipeline"
log "INFO" "========================================="
log "INFO" "PRD:            $PRD_FILE"
log "INFO" "Repo:           $REPO_URL"
log "INFO" "Branch:         $BASE_BRANCH"
if [ -n "$STACK_ON" ]; then
  log "INFO" "Stack on:       $STACK_ON"
fi
log "INFO" "Agents:         $AGENTS"
log "INFO" "Model:          $MODEL"
log "INFO" "Max Iterations: $MAX_ITERATIONS"
log "INFO" "Dev Container:  $USE_DEVCONTAINER"
log "INFO" "Verbose Logs:   $VERBOSE_LOGS"
log "INFO" "Interactive:    $INTERACTIVE"
log "INFO" "========================================="

validate_environment || exit 1
validate_prd "$PRD_FILE" || exit 1

if [ "$USE_DEVCONTAINER" = true ]; then
  validate_devcontainer_deps || exit 1
fi

# --- Resolve Git identity used by agent commits ---
if [ -n "${GIT_AUTHOR_NAME:-}" ] && [ -n "${GIT_AUTHOR_EMAIL:-}" ]; then
  PIPELINE_GIT_NAME="$GIT_AUTHOR_NAME"
  PIPELINE_GIT_EMAIL="$GIT_AUTHOR_EMAIL"
else
  PIPELINE_GIT_NAME="$(git config --global --get user.name 2>/dev/null || true)"
  PIPELINE_GIT_EMAIL="$(git config --global --get user.email 2>/dev/null || true)"
fi

if [ -n "$PIPELINE_GIT_NAME" ] && [ -n "$PIPELINE_GIT_EMAIL" ]; then
  export GIT_AUTHOR_NAME="$PIPELINE_GIT_NAME"
  export GIT_AUTHOR_EMAIL="$PIPELINE_GIT_EMAIL"
  export GIT_COMMITTER_NAME="$PIPELINE_GIT_NAME"
  export GIT_COMMITTER_EMAIL="$PIPELINE_GIT_EMAIL"
  log "INFO" "Using Git identity for pipeline commits: $PIPELINE_GIT_NAME <$PIPELINE_GIT_EMAIL>"
else
  log "WARN" "Git identity not found on host (user.name/user.email). Agent commits may use fallback identity."
fi

# --- Prepare Repository ---
REPO_NAME=$(basename "$REPO_URL" .git)
REPO_WORKDIR="$WORK_DIR/$REPO_NAME"

log "INFO" "Preparing repository at $REPO_WORKDIR..."
clone_or_prepare_repo "$REPO_URL" "$REPO_WORKDIR" "$BASE_BRANCH"

if [ "$REPO_WAS_EMPTY" = true ]; then
  log "INFO" "Empty repository — working directly on $BASE_BRANCH (no feature branch, no PR)"
  FEATURE_BRANCH="$BASE_BRANCH"
  SKIP_PR=true
else
  # When stacking, branch off the stack-on branch instead of the base branch
  if [ -n "$STACK_ON" ]; then
    cd "$REPO_WORKDIR" || exit 1
    git fetch origin "$STACK_ON" 2>/dev/null || true
    if git show-ref --verify --quiet "refs/remotes/origin/$STACK_ON"; then
      git checkout "$STACK_ON" 2>/dev/null || git checkout -b "$STACK_ON" "origin/$STACK_ON"
      git pull origin "$STACK_ON" 2>/dev/null || true
      log "INFO" "Stacking: branching from $STACK_ON"
    else
      log "WARN" "Stack-on branch $STACK_ON not found on remote — falling back to $BASE_BRANCH"
      STACK_ON=""
    fi
  fi

  WORKING_BRANCH=$(parse_prd_working_branch "$PRD_FILE")
  FEATURE_BRANCH="${WORKING_BRANCH:-$(generate_branch_name "$PRD_FILE")}"
  create_feature_branch "$REPO_WORKDIR" "$FEATURE_BRANCH"
fi

# PR targets the stack-on branch when stacking, otherwise the base branch
PR_TARGET="${STACK_ON:-$BASE_BRANCH}"

log "INFO" "Working on branch: $FEATURE_BRANCH"

# Ensure local-only runtime artifacts are ignored in target repo
mkdir -p "$REPO_WORKDIR/.git/info"
if ! grep -q '^\.agent-progress/' "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
  echo ".agent-progress/" >> "$REPO_WORKDIR/.git/info/exclude"
fi
if ! grep -q '^\.pipeline/' "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
  echo ".pipeline/" >> "$REPO_WORKDIR/.git/info/exclude"
fi
if ! grep -q '^logs/' "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
  echo "logs/" >> "$REPO_WORKDIR/.git/info/exclude"
fi

# --- Inject Context (ephemeral, never committed) ---
# Supports both single-file and directory-based contexts.
# Written to CLAUDE.md or GEMINI.md depending on the AI provider.
CTX_FILENAME=$(provider_context_filename)
if [ -n "$CONTEXT_FILE" ]; then
  CONTEXT_FILE=$(realpath "$CONTEXT_FILE")
  if [ -d "$CONTEXT_FILE" ]; then
    log "INFO" "Injecting context directory: $CONTEXT_FILE → $CTX_FILENAME (ephemeral)"
    assemble_context_skills "$CONTEXT_FILE" "$REPO_WORKDIR/$CTX_FILENAME"
    if ! grep -q "^${CTX_FILENAME}$" "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
      echo "$CTX_FILENAME" >> "$REPO_WORKDIR/.git/info/exclude"
    fi
  elif [ -f "$CONTEXT_FILE" ]; then
    log "INFO" "Injecting context file: $CONTEXT_FILE → $CTX_FILENAME (ephemeral)"
    cp "$CONTEXT_FILE" "$REPO_WORKDIR/$CTX_FILENAME"
    if ! grep -q "^${CTX_FILENAME}$" "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
      echo "$CTX_FILENAME" >> "$REPO_WORKDIR/.git/info/exclude"
    fi
  else
    log "WARN" "Context not found: $CONTEXT_FILE (continuing without it)"
  fi
fi

# Copy PRD into the repo for agent reference
PRD_SLUG=$(basename "$PRD_FILE" .md)
mkdir -p "$REPO_WORKDIR/docs/architecture/$PRD_SLUG"
cp "$PRD_FILE" "$REPO_WORKDIR/docs/architecture/$PRD_SLUG/prd.md"
cd "$REPO_WORKDIR" && git add "docs/architecture/$PRD_SLUG/prd.md" && git commit -m "docs: add PRD for $PRD_SLUG" --allow-empty 2>/dev/null || true

# --- Initialize Progress ---
init_progress_dir "$REPO_WORKDIR"
rm -f "$REPO_WORKDIR/$PROGRESS_DIR/"*.md 2>/dev/null || true
log "INFO" "Cleared previous agent progress state for a fresh PRD run"

# =============================================================================
# Dev Container Setup
# =============================================================================
CONTAINER_ID=""
CONTAINER_WORKSPACE=""
DEVCONTAINER_CONFIG=""

cleanup_container() {
  if [ -n "$CONTAINER_ID" ]; then
    log "INFO" "Stopping Dev Container..."
    docker stop "$CONTAINER_ID" 2>/dev/null || true
    docker rm "$CONTAINER_ID" 2>/dev/null || true
  fi
}

if [ "$USE_DEVCONTAINER" = true ]; then
  DEVCONTAINER_CONFIG="$SCRIPT_DIR/../.devcontainer/agent/devcontainer.json"

  # Stage pipeline tools in the workspace so they're accessible inside the container
  PIPELINE_STAGING="$REPO_WORKDIR/.pipeline"
  rm -rf "$PIPELINE_STAGING"
  mkdir -p "$PIPELINE_STAGING"
  cp -r "$SCRIPT_DIR/." "$PIPELINE_STAGING/pipeline/"
  cp -r "$SCRIPT_DIR/../agents" "$PIPELINE_STAGING/agents"
  cp "$PRD_FILE" "$PIPELINE_STAGING/prd.md"

  # Helper script for running the AI CLI from a prompt file inside the container
  cat > "$PIPELINE_STAGING/run-ai.sh" << 'HELPER'
#!/bin/bash
PROMPT_FILE="$1"; shift
CLI="${AI_PROVIDER:-claude}"
case "$CLI" in
  gemini) gemini -p "$(cat "$PROMPT_FILE")" "$@" ;;
  *)      claude -p "$(cat "$PROMPT_FILE")" "$@" ;;
esac
HELPER
  chmod +x "$PIPELINE_STAGING/run-ai.sh"

  # Exclude from git
  if ! grep -q '^\.pipeline/' "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
    echo ".pipeline/" >> "$REPO_WORKDIR/.git/info/exclude"
  fi

  log "INFO" "Starting Dev Container (first run builds the image, may take a few minutes)..."

  CONTAINER_UP_OUTPUT=$(devcontainer up \
    --workspace-folder "$REPO_WORKDIR" \
    --config "$DEVCONTAINER_CONFIG" 2>&1) || {
    log "ERROR" "Failed to start Dev Container. Output:"
    echo "$CONTAINER_UP_OUTPUT" >&2
    exit 1
  }

  # Parse container info from devcontainer up JSON output
  CONTAINER_ID=$(echo "$CONTAINER_UP_OUTPUT" | grep '{' | tail -1 | jq -r '.containerId // empty' 2>/dev/null || true)
  CONTAINER_WORKSPACE=$(echo "$CONTAINER_UP_OUTPUT" | grep '{' | tail -1 | jq -r '.remoteWorkspaceFolder // empty' 2>/dev/null || true)

  if [ -z "$CONTAINER_WORKSPACE" ]; then
    CONTAINER_WORKSPACE="/workspaces/$REPO_NAME"
  fi

  short_container_id="${CONTAINER_ID:0:12}"
  log "INFO" "Dev Container started (ID: $short_container_id)"
  log "INFO" "Container workspace: $CONTAINER_WORKSPACE"

  trap cleanup_container EXIT
fi

# =============================================================================
# Helper: run a command either inside the container or on the host
# =============================================================================
exec_in_environment() {
  if [ "$USE_DEVCONTAINER" = true ]; then
    local remote_env_args=()
    if [ -n "$PIPELINE_GIT_NAME" ] && [ -n "$PIPELINE_GIT_EMAIL" ]; then
      remote_env_args+=(
        --remote-env "GIT_AUTHOR_NAME=$PIPELINE_GIT_NAME"
        --remote-env "GIT_AUTHOR_EMAIL=$PIPELINE_GIT_EMAIL"
        --remote-env "GIT_COMMITTER_NAME=$PIPELINE_GIT_NAME"
        --remote-env "GIT_COMMITTER_EMAIL=$PIPELINE_GIT_EMAIL"
      )
    fi
    if [ -n "$CONTAINER_WORKSPACE" ]; then
      remote_env_args+=(--remote-env "LOG_DIR=$CONTAINER_WORKSPACE/.pipeline/logs")
    fi
    remote_env_args+=(--remote-env "AI_PROVIDER=$AI_PROVIDER")

    devcontainer exec \
      --workspace-folder "$REPO_WORKDIR" \
      --config "$DEVCONTAINER_CONFIG" \
      "${remote_env_args[@]}" \
      "$@"
  else
    "$@"
  fi
}

validate_provider_auth() {
  if [ "$USE_DEVCONTAINER" = true ]; then
    local cli
    cli=$(provider_cli)

    case "$AI_PROVIDER" in
      claude)
        if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
          log "INFO" "CLAUDE_CODE_OAUTH_TOKEN detected in pipeline environment (length: ${#CLAUDE_CODE_OAUTH_TOKEN})"
        else
          log "INFO" "CLAUDE_CODE_OAUTH_TOKEN is not set in pipeline environment"
        fi
        ;;
      gemini)
        if [ -n "${GEMINI_API_KEY:-}" ]; then
          log "INFO" "GEMINI_API_KEY detected in pipeline environment"
        elif [ -n "${GOOGLE_API_KEY:-}" ]; then
          log "INFO" "GOOGLE_API_KEY detected in pipeline environment"
        else
          log "INFO" "No Gemini API key set in pipeline environment — using Google account auth"
        fi
        ;;
    esac

    set +e
    auth_status_output=$(exec_in_environment bash -lc "$(provider_auth_check_cmd) 2>&1")
    local auth_exit=$?
    set -e

    if [ $auth_exit -eq 0 ]; then
      case "$AI_PROVIDER" in
        claude)
          if echo "$auth_status_output" | grep -q '"loggedIn":[[:space:]]*true'; then
            log "INFO" "$cli auth preflight succeeded inside Dev Container"
            return 0
          fi
          ;;
        gemini)
          log "INFO" "$cli auth preflight succeeded inside Dev Container"
          return 0
          ;;
      esac
    fi

    if [ -n "$auth_status_output" ]; then
      log "ERROR" "Dev Container auth status:"
      while IFS= read -r line; do
        log "ERROR" "  $line"
      done <<< "$auth_status_output"
    fi

    if [ $auth_exit -ne 0 ]; then
      log "ERROR" "$cli auth status command failed inside Dev Container (exit: $auth_exit)"
    else
      log "ERROR" "$cli is not authenticated inside the Dev Container."
    fi

    case "$AI_PROVIDER" in
      claude)
        log "ERROR" "Fix one of the following, then rerun:"
        log "ERROR" "  1) Set ANTHROPIC_API_KEY in .env so container auth uses API key"
        log "ERROR" "  2) Set CLAUDE_CODE_OAUTH_TOKEN in .env (generate with: claude setup-token)"
        log "ERROR" "  3) Run with --no-devcontainer to use host Claude auth directly"
        ;;
      gemini)
        log "ERROR" "Fix one of the following, then rerun:"
        log "ERROR" "  1) Set GEMINI_API_KEY in .env"
        log "ERROR" "  2) Set GOOGLE_API_KEY in .env"
        log "ERROR" "  3) Run with --no-devcontainer to use host Gemini auth directly"
        ;;
    esac
    return 1
  fi

  return 0
}

# =============================================================================
# Run Agents
# =============================================================================
validate_provider_auth || exit 1

IFS=',' read -ra AGENT_LIST <<< "$AGENTS"
PREVIOUS_AGENTS=""

resolve_agent_model() {
  local agent="$1"
  local agent_upper model_var
  agent_upper=$(echo "$agent" | tr '[:lower:]-' '[:upper:]_')
  model_var="${agent_upper}_MODEL"

  if [ -n "${!model_var:-}" ]; then
    echo "${!model_var}"
  else
    echo "$MODEL"
  fi
}

for agent in "${AGENT_LIST[@]}"; do
  agent=$(echo "$agent" | xargs)
  agent_model=$(resolve_agent_model "$agent")

  log "INFO" ""
  log "INFO" "========================================="
  log "INFO" "  Running Agent: $agent"
  log "INFO" "  Model: $agent_model"
  log "INFO" "========================================="

  if is_agent_completed "$REPO_WORKDIR" "$agent"; then
    log "INFO" "Agent $agent already completed. Skipping."
    PREVIOUS_AGENTS="${PREVIOUS_AGENTS:+$PREVIOUS_AGENTS,}$agent"
    continue
  fi

  # Build optional flags for run-agent.sh
  agent_extra_flags=""
  [ "$VERBOSE_LOGS" = true ] && agent_extra_flags+=" --verbose-logs"
  [ "$INTERACTIVE" = true ] && agent_extra_flags+=" --interactive"

  # Run the agent via Ralph Loop
  set +e
  if [ "$USE_DEVCONTAINER" = true ]; then
    exec_in_environment \
      bash "$CONTAINER_WORKSPACE/.pipeline/pipeline/run-agent.sh" \
        --agent "$agent" \
        --workdir "$CONTAINER_WORKSPACE" \
        --prd "$CONTAINER_WORKSPACE/.pipeline/prd.md" \
        --max-iterations "$MAX_ITERATIONS" \
        --model "$agent_model" \
        --previous-agents "$PREVIOUS_AGENTS" \
        $agent_extra_flags
  else
    "$SCRIPT_DIR/run-agent.sh" \
      --agent "$agent" \
      --workdir "$REPO_WORKDIR" \
      --prd "$PRD_FILE" \
      --max-iterations "$MAX_ITERATIONS" \
      --model "$agent_model" \
      --previous-agents "$PREVIOUS_AGENTS" \
      $agent_extra_flags
  fi
  agent_exit=$?
  set -e

  if ! validate_agent_output "$REPO_WORKDIR" "$agent"; then
    log "WARN" "Agent $agent did not complete successfully (exit: $agent_exit)"

    case "$agent" in
      designer|migration|accessibility|performance|dependency|rollback|documentation)
        log "INFO" "$agent is non-blocking — continuing pipeline"
        ;;
      *)
        log "ERROR" "Critical agent $agent failed. Stopping pipeline."
        log "ERROR" "Review logs at: $LOG_DIR/"
        log "ERROR" "Review progress at: $REPO_WORKDIR/$PROGRESS_DIR/"
        exit 1
        ;;
    esac
  fi

  # Safety net: remove runtime artifacts if an agent accidentally committed them
  runtime_dirty=false
  for runtime_path in .agent-progress logs .pipeline CLAUDE.md GEMINI.md; do
    if git -C "$REPO_WORKDIR" ls-files --error-unmatch "$runtime_path" &>/dev/null; then
      git -C "$REPO_WORKDIR" rm -r --cached "$runtime_path" &>/dev/null || true
      runtime_dirty=true
    fi
  done
  if [ "$runtime_dirty" = true ]; then
    git -C "$REPO_WORKDIR" commit -m "chore: remove accidentally committed runtime artifacts" 2>/dev/null || true
    log "WARN" "Removed runtime artifacts that were accidentally committed by agent $agent"
  fi

  PREVIOUS_AGENTS="${PREVIOUS_AGENTS:+$PREVIOUS_AGENTS,}$agent"

  log "INFO" "Agent $agent finished."

  # Interactive pause between agents
  if [ "$INTERACTIVE" = true ] && [ -t 0 ]; then
    # Check if there are more agents remaining
    remaining_agents=false
    found_current=false
    for next_agent in "${AGENT_LIST[@]}"; do
      next_agent=$(echo "$next_agent" | xargs)
      if [ "$found_current" = true ]; then
        if ! is_agent_completed "$REPO_WORKDIR" "$next_agent"; then
          remaining_agents=true
          break
        fi
      fi
      if [ "$next_agent" = "$agent" ]; then
        found_current=true
      fi
    done

    if [ "$remaining_agents" = true ]; then
      echo "" >&2
      echo "  Agent '$agent' complete. Next agents remaining." >&2
      echo "  Options:" >&2
      echo "    Enter     = continue to next agent" >&2
      echo "    s + Enter = skip remaining agents" >&2
      echo "    q + Enter = abort pipeline" >&2
      echo "" >&2
      read -r user_input
      case "$user_input" in
        s|S|skip)
          log "INFO" "User skipped remaining agents after $agent"
          break
          ;;
        q|Q|quit|abort)
          log "INFO" "User aborted pipeline after agent $agent"
          exit 1
          ;;
      esac
    fi
  fi
done

# =============================================================================
# Update Project Context
# =============================================================================
UPDATE_CONTEXT="${UPDATE_PROJECT_CONTEXT:-true}"
if [ "$UPDATE_CONTEXT" = "true" ] && [ -f "$REPO_WORKDIR/$CTX_FILENAME" ]; then
  log "INFO" ""
  log "INFO" "========================================="
  log "INFO" "  Updating Project Context ($CTX_FILENAME)"
  log "INFO" "========================================="

  CONTEXT_IS_EPHEMERAL=false
  if grep -q "^${CTX_FILENAME}$" "$REPO_WORKDIR/.git/info/exclude" 2>/dev/null; then
    CONTEXT_IS_EPHEMERAL=true
  fi

  if [ "$CONTEXT_IS_EPHEMERAL" = true ]; then
    COMMIT_INSTRUCTION="After updating $CTX_FILENAME, do NOT commit it — it is an ephemeral file managed outside this repo."
  else
    COMMIT_INSTRUCTION="After updating, commit with message: \"docs: update project context after pipeline run\""
  fi

  CONTEXT_PROMPT=$(cat <<CTXEOF
You are updating the project context file ($CTX_FILENAME) to reflect changes made by a development pipeline.

Read the current $CTX_FILENAME, then review the code that was just added or modified. Update $CTX_FILENAME to accurately describe:
- Any new directories, files, or patterns that were introduced
- Any new dependencies that were added
- Any new conventions established by the code
- Updated "Common Tasks" if new workflows were introduced

Keep the same format and structure. Only update sections that are affected by the changes. Do not remove existing content that is still accurate. Be concise.

$COMMIT_INSTRUCTION
CTXEOF
)

  # Write prompt to temp file (consistent with provider_run interface)
  ctx_prompt_file=$(mktemp)
  echo "$CONTEXT_PROMPT" > "$ctx_prompt_file"

  set +e
  if [ "$USE_DEVCONTAINER" = true ]; then
    cp "$ctx_prompt_file" "$REPO_WORKDIR/.pipeline/.context-prompt.tmp"
    rm -f "$ctx_prompt_file"

    # Build provider-specific flags for the container helper
    local container_cli_args=()
    case "$AI_PROVIDER" in
      gemini)
        container_cli_args=(--model "$MODEL" --yolo --output-format)
        ;;
      *)
        container_cli_args=(--model "$MODEL" --allowedTools "Edit,Write,Bash,Read,MultiEdit" --dangerously-skip-permissions --output-format)
        ;;
    esac

    if [ "$VERBOSE_LOGS" = true ]; then
      exec_in_environment \
        bash "$CONTAINER_WORKSPACE/.pipeline/run-ai.sh" \
          "$CONTAINER_WORKSPACE/.pipeline/.context-prompt.tmp" \
          "${container_cli_args[@]}" stream-json \
          $([ "$AI_PROVIDER" = "claude" ] && echo "--verbose") \
        2>&1 | "$SCRIPT_DIR/lib/log-formatter.sh" \
          --provider "$AI_PROVIDER" \
          --raw-log "$LOG_DIR/context_update.jsonl" \
        | tee -a "$LOG_DIR/context_update.log"
    else
      exec_in_environment \
        bash "$CONTAINER_WORKSPACE/.pipeline/run-ai.sh" \
          "$CONTAINER_WORKSPACE/.pipeline/.context-prompt.tmp" \
          "${container_cli_args[@]}" text \
        2>&1 | tee -a "$LOG_DIR/context_update.log"
    fi
  else
    if [ "$VERBOSE_LOGS" = true ]; then
      provider_run "$ctx_prompt_file" "$MODEL" "Edit,Write,Bash,Read,MultiEdit" "stream-json" true \
        2>&1 | "$SCRIPT_DIR/lib/log-formatter.sh" \
          --provider "$AI_PROVIDER" \
          --raw-log "$LOG_DIR/context_update.jsonl" \
        | tee -a "$LOG_DIR/context_update.log"
    else
      provider_run "$ctx_prompt_file" "$MODEL" "Edit,Write,Bash,Read,MultiEdit" "text" false \
        2>&1 | tee -a "$LOG_DIR/context_update.log"
    fi
    rm -f "$ctx_prompt_file"
  fi
  context_exit=$?
  set -e

  if [ $context_exit -eq 0 ]; then
    log "INFO" "Project context updated successfully"
    if [ "$CONTEXT_IS_EPHEMERAL" = true ] && [ -n "$CONTEXT_FILE" ] && [ -f "$REPO_WORKDIR/$CTX_FILENAME" ]; then
      if [ -d "$CONTEXT_FILE" ]; then
        log "INFO" "Context is directory-based — skipping sync-back (re-run generate-context.sh to update skills)"
      else
        cp "$REPO_WORKDIR/$CTX_FILENAME" "$CONTEXT_FILE"
        log "INFO" "Updated context synced back to: $CONTEXT_FILE"
      fi
    fi
  else
    log "WARN" "Failed to update project context (non-blocking)"
  fi
fi

# =============================================================================
# Stop Dev Container (before PR creation, which uses host git/gh)
# =============================================================================
if [ "$USE_DEVCONTAINER" = true ] && [ -n "$CONTAINER_ID" ]; then
  cleanup_container
  CONTAINER_ID=""
  trap - EXIT
fi

# =============================================================================
# Rebase & Create Pull Request (runs on host — uses host git and gh auth)
# =============================================================================

# Write feature branch marker so the orchestrator can read it for stacking
mkdir -p "$REPO_WORKDIR/.pipeline"
echo "$FEATURE_BRANCH" > "$REPO_WORKDIR/.pipeline/feature-branch"

PR_URL=""
if [ "$SKIP_PR" = false ]; then
  log "INFO" ""
  log "INFO" "========================================="
  log "INFO" "  Rebasing & Creating Pull Request"
  log "INFO" "========================================="

  # Rebase onto latest target to reduce conflicts
  rebase_onto_latest "$REPO_WORKDIR" "$PR_TARGET" || {
    log "WARN" "Rebase onto $PR_TARGET had conflicts — PR may require manual resolution"
  }

  if ! command -v gh &> /dev/null; then
    log "ERROR" "GitHub CLI (gh) is required for PR creation. Install with: brew install gh"
    exit 1
  fi

  for attempt in 1 2 3; do
    set +e
    PR_URL=$(create_pull_request "$REPO_WORKDIR" "$PR_TARGET" "$PRD_SLUG")
    pr_exit=$?
    set -e

    if [ $pr_exit -eq 0 ] && [ -n "$PR_URL" ]; then
      log "INFO" "Pull Request created successfully!"
      log "INFO" "PR URL: $PR_URL"
      if [ -n "$STACK_ON" ]; then
        log "INFO" "PR targets stacked branch: $STACK_ON"
      fi
      break
    fi

    if [ "$attempt" -lt 3 ]; then
      log "WARN" "PR creation attempt $attempt/3 failed. Retrying in 5s..."
      sleep 5
    fi
  done

  if [ -z "$PR_URL" ]; then
    log "ERROR" "Failed to create PR after 3 attempts. Branch: $FEATURE_BRANCH"
    exit 1
  fi

  # Post evidence comments on the PR
  post_pr_evidence "$REPO_WORKDIR" "$PR_URL" "$PRD_SLUG" "$EVIDENCE_AGENTS"
else
  if [ "$REPO_WAS_EMPTY" = true ]; then
    log "INFO" "Pushing $BASE_BRANCH to origin (initial repo content, no PR needed)..."
    cd "$REPO_WORKDIR" && git push -u origin "$BASE_BRANCH"
    log "INFO" "Branch $BASE_BRANCH pushed successfully"
  else
    log "INFO" "Skipping PR creation (--skip-pr flag)"
    log "INFO" "Branch $FEATURE_BRANCH is ready at $REPO_WORKDIR"
  fi
fi

# --- Summary ---
log "INFO" ""
log "INFO" "========================================="
log "INFO" "  Pipeline Complete"
log "INFO" "========================================="
log "INFO" "Repository: $REPO_WORKDIR"
log "INFO" "Branch:     $FEATURE_BRANCH"
log "INFO" "Agents run: $AGENTS"
log "INFO" ""

for agent in "${AGENT_LIST[@]}"; do
  agent=$(echo "$agent" | xargs)
  status=$(get_agent_status "$REPO_WORKDIR" "$agent")
  log "INFO" "  $agent: $status"
done

log "INFO" ""
log "INFO" "Logs:     $LOG_DIR/"
log "INFO" "Progress: $REPO_WORKDIR/$PROGRESS_DIR/"
log "INFO" "========================================="
