#!/bin/bash
set -euo pipefail

# =============================================================================
# orchestrator.sh — Batch pipeline: Manifest → Orders → PRDs → Repos → PRs
# =============================================================================
# Reads a manifest JSON that defines execution orders. Each order contains PRDs
# that run in parallel. Each PRD targets one or more repositories, each with
# its own context file and branch.
#
# Orders execute sequentially (order N must complete before order N+1 starts).
# PRDs within an order execute in parallel by default.
#
# Usage:
#   # Run from a manifest (recommended)
#   ./pipeline/orchestrator.sh --manifest ./manifests/portfolio.json
#
#   # Run a single order from the manifest
#   ./pipeline/orchestrator.sh --manifest ./manifests/portfolio.json --order 1
#
#   # Legacy: single PRD with explicit repo and context
#   ./pipeline/orchestrator.sh --prd ./prds/feature.md --repo <url> --context ./contexts/repo.md

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/lib/prd-parser.sh"
source "$SCRIPT_DIR/lib/provider.sh"
source "$SCRIPT_DIR/lib/validation.sh"

# --- Load .env if present ---
if [ -f "$SCRIPT_DIR/../.env" ]; then
  set -a
  source "$SCRIPT_DIR/../.env"
  set +a
fi

# --- Logging ---
LOG_LEVEL="${LOG_LEVEL:-info}"
LOG_DIR="${LOG_DIR:-./logs}"
mkdir -p "$LOG_DIR"

log() {
  local level="$1"
  local msg="$2"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] [$level] $msg" >&2
  echo "[$timestamp] [$level] $msg" >> "$LOG_DIR/orchestrator.log"
}

# --- Argument Parsing ---
MANIFEST_FILE=""
TARGET_ORDER=""
PRD_FILES=()
PRD_DIR=""
REPO_OVERRIDE=""
BRANCH_OVERRIDE=""
CONTEXT_FILE=""
WORK_DIR="${PIPELINE_WORK_DIR:-/tmp/coding-agents-work}"
AGENTS="architect,designer,migration,developer,accessibility,tester,performance,secops,dependency,infrastructure,devops,rollback,documentation,reviewer"
SKIP_PR=false
NO_CONTEXT_UPDATE=false
NO_DEVCONTAINER=false
AUTO_CONTINUE=false
MODEL="$(provider_default_model)"
MAX_ITERATIONS="${PIPELINE_MAX_ITERATIONS:-10}"
SEQUENTIAL=false
MAX_PARALLEL="${PIPELINE_MAX_PARALLEL:-4}"
EVIDENCE_AGENTS="${EVIDENCE_AGENTS:-tester,performance,secops,dependency,infrastructure,devops}"
VERBOSE_LOGS="${VERBOSE_LOGS:-false}"
INTERACTIVE="${INTERACTIVE:-false}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --manifest) MANIFEST_FILE="$2"; shift 2 ;;
    --order) TARGET_ORDER="$2"; shift 2 ;;
    --prd) PRD_FILES+=("$2"); shift 2 ;;
    --prd-dir) PRD_DIR="$2"; shift 2 ;;
    --repo) REPO_OVERRIDE="$2"; shift 2 ;;
    --context) CONTEXT_FILE="$2"; shift 2 ;;
    --branch) BRANCH_OVERRIDE="$2"; shift 2 ;;
    --workdir) WORK_DIR="$2"; shift 2 ;;
    --agents) AGENTS="$2"; shift 2 ;;
    --skip-pr) SKIP_PR=true; shift ;;
    --no-context-update) NO_CONTEXT_UPDATE=true; shift ;;
    --no-devcontainer) NO_DEVCONTAINER=true; shift ;;
    --auto) AUTO_CONTINUE=true; shift ;;
    --model) MODEL="$2"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
    --sequential) SEQUENTIAL=true; shift ;;
    --max-parallel) MAX_PARALLEL="$2"; shift 2 ;;
    --evidence-agents) EVIDENCE_AGENTS="$2"; shift 2 ;;
    --verbose-logs) VERBOSE_LOGS=true; shift ;;
    --interactive) INTERACTIVE=true; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: orchestrator.sh [options]

Manifest mode (recommended):
  --manifest <path>         JSON manifest with orders, PRDs, repos, and contexts
  --order <n>               Run only the nth order (1-based). Omit to run all.
  --auto                    Skip confirmation prompts between orders

Legacy mode (single PRD):
  --prd <path>              PRD file (can be repeated for multiple PRDs)
  --prd-dir <dir>           Directory containing PRD .md files
  --repo <url>              Target repository URL
  --context <path>          Project context (file or skill directory, injected as ephemeral context)
  --branch <name>           Base branch (default: main)

Pipeline options:
  --agents <list>           Comma-separated agent list (default: architect,designer,migration,developer,accessibility,tester,performance,secops,dependency,infrastructure,devops,rollback,documentation,reviewer)
  --skip-pr                 Don't create PRs at the end
  --no-context-update       Don't update project context after agents finish
  --no-devcontainer         Run agents on host instead of inside Dev Containers
  --model <name>            AI model (default depends on AI_PROVIDER)
  --max-iterations <n>      Per-agent iteration cap (default: 10)
  --evidence-agents <list>  Agents whose reports are posted as PR comments
                            (default: tester,performance,secops,dependency,infrastructure,devops)

Execution:
  --sequential              Run work units one at a time (default: parallel)
  --max-parallel <n>        Max concurrent pipelines (default: 4)
  --workdir <path>          Working directory for cloned repos

Monitoring & interaction:
  --verbose-logs            Detailed agent logging (thinking, tool calls, results)
  --interactive             Pause between agents and iterations for review

  -h, --help                Show this help
HELP
      exit 0
      ;;
    *) log "ERROR" "Unknown argument: $1"; exit 1 ;;
  esac
done

# --- Validate inputs ---
if [ -z "$MANIFEST_FILE" ] && [ ${#PRD_FILES[@]} -eq 0 ] && [ -z "$PRD_DIR" ]; then
  log "ERROR" "No input specified. Use --manifest <path>, --prd <file>, or --prd-dir <dir>."
  exit 1
fi

validate_environment || exit 1

# --- Build common flags for run-pipeline.sh ---
build_extra_flags() {
  local flags=""
  [ "$SKIP_PR" = true ] && flags+=" --skip-pr"
  [ "$NO_CONTEXT_UPDATE" = true ] && flags+=" --no-context-update"
  [ "$NO_DEVCONTAINER" = true ] && flags+=" --no-devcontainer"
  [ "$VERBOSE_LOGS" = true ] && flags+=" --verbose-logs"
  [ "$INTERACTIVE" = true ] && flags+=" --interactive"
  flags+=" --evidence-agents $EVIDENCE_AGENTS"
  echo "$flags"
}

EXTRA_FLAGS=$(build_extra_flags)

# =============================================================================
# Run a single work unit: PRD × Repo
# =============================================================================
run_work_unit() {
  local prd_file="$1"
  local repo_url="$2"
  local branch="$3"
  local context="$4"
  local label="$5"
  local index="$6"
  local unit_agents="${7:-$AGENTS}"
  local stack_on="${8:-}"

  local prd_slug repo_name unit_log
  prd_slug=$(basename "$prd_file" .md)
  repo_name=$(basename "$repo_url" .git)
  unit_log="$LOG_DIR/unit_${prd_slug}_${repo_name}.log"

  log "INFO" "[$index] Starting: $label"

  local context_flag=""
  if [ -n "$context" ]; then
    context_flag="--context $context"
  fi

  local stack_flag=""
  if [ -n "$stack_on" ]; then
    stack_flag="--stack-on $stack_on"
  fi

  "$SCRIPT_DIR/run-pipeline.sh" \
    --prd "$prd_file" \
    --repo "$repo_url" \
    --branch "$branch" \
    --workdir "$WORK_DIR" \
    --agents "$unit_agents" \
    --model "$MODEL" \
    --max-iterations "$MAX_ITERATIONS" \
    $context_flag \
    $stack_flag \
    $EXTRA_FLAGS \
    2>&1 | tee "$unit_log"

  return ${PIPESTATUS[0]}
}

# =============================================================================
# Execute a list of work units (parallel or sequential)
# =============================================================================
# Each unit is: "prd_path|repo_url|branch|context|agents|stack_on"
# Fields 5 (agents) and 6 (stack_on) are optional.
# Each label is: human-readable description
execute_work_units() {
  local -a units=()
  local -a labels=()
  local i

  # Read units and labels from positional args: units... -- labels...
  local reading_units=true
  for arg in "$@"; do
    if [ "$arg" = "--" ]; then
      reading_units=false
      continue
    fi
    if [ "$reading_units" = true ]; then
      units+=("$arg")
    else
      labels+=("$arg")
    fi
  done

  local PIDS=()
  local PID_LABELS=()
  local RESULTS=()
  local ACTIVE_JOBS=0

  if [ "$SEQUENTIAL" = true ]; then
    for i in "${!units[@]}"; do
      local index=$((i+1))
      local prd_file repo_url branch context unit_agents stack_on
      prd_file=$(echo "${units[$i]}" | cut -d'|' -f1)
      repo_url=$(echo "${units[$i]}" | cut -d'|' -f2)
      branch=$(echo "${units[$i]}" | cut -d'|' -f3)
      context=$(echo "${units[$i]}" | cut -d'|' -f4)
      unit_agents=$(echo "${units[$i]}" | cut -d'|' -f5)
      stack_on=$(echo "${units[$i]}" | cut -d'|' -f6)

      set +e
      run_work_unit "$prd_file" "$repo_url" "$branch" "$context" "${labels[$i]}" "$index" "$unit_agents" "$stack_on"
      local exit_code=$?
      set -e

      if [ $exit_code -eq 0 ]; then
        RESULTS[$index]="SUCCESS"
        log "INFO" "[$index] Completed: ${labels[$i]}"
      else
        RESULTS[$index]="FAILED"
        log "ERROR" "[$index] Failed: ${labels[$i]} (exit code: $exit_code)"
      fi
    done
  else
    for i in "${!units[@]}"; do
      local index=$((i+1))
      local prd_file repo_url branch context unit_agents stack_on
      prd_file=$(echo "${units[$i]}" | cut -d'|' -f1)
      repo_url=$(echo "${units[$i]}" | cut -d'|' -f2)
      branch=$(echo "${units[$i]}" | cut -d'|' -f3)
      context=$(echo "${units[$i]}" | cut -d'|' -f4)
      unit_agents=$(echo "${units[$i]}" | cut -d'|' -f5)
      stack_on=$(echo "${units[$i]}" | cut -d'|' -f6)

      # Throttle
      while [ "$ACTIVE_JOBS" -ge "$MAX_PARALLEL" ]; do
        for pi in "${!PIDS[@]}"; do
          if [ -n "${PIDS[$pi]:-}" ] && ! kill -0 "${PIDS[$pi]}" 2>/dev/null; then
            set +e
            wait "${PIDS[$pi]}"
            local child_exit=$?
            set -e

            local li=$((pi+1))
            if [ $child_exit -eq 0 ]; then
              RESULTS[$li]="SUCCESS"
              log "INFO" "[$li] Completed: ${PID_LABELS[$pi]}"
            else
              RESULTS[$li]="FAILED"
              log "ERROR" "[$li] Failed: ${PID_LABELS[$pi]}"
            fi
            PIDS[$pi]=""
            ACTIVE_JOBS=$((ACTIVE_JOBS - 1))
            break
          fi
        done
        sleep 1
      done

      run_work_unit "$prd_file" "$repo_url" "$branch" "$context" "${labels[$i]}" "$index" "$unit_agents" "$stack_on" &
      PIDS[$i]=$!
      PID_LABELS[$i]="${labels[$i]}"
      ACTIVE_JOBS=$((ACTIVE_JOBS + 1))
      log "INFO" "[$index] Launched (PID: ${PIDS[$i]})"
    done

    # Wait for remaining
    for i in "${!PIDS[@]}"; do
      local index=$((i+1))
      if [ -n "${PIDS[$i]:-}" ] && [ -z "${RESULTS[$index]:-}" ]; then
        set +e
        wait "${PIDS[$i]}"
        local child_exit=$?
        set -e

        if [ $child_exit -eq 0 ]; then
          RESULTS[$index]="SUCCESS"
          log "INFO" "[$index] Completed: ${PID_LABELS[$i]}"
        else
          RESULTS[$index]="FAILED"
          log "ERROR" "[$index] Failed: ${PID_LABELS[$i]}"
        fi
      fi
    done
  fi

  # Print summary and return success/fail count
  local success_count=0 fail_count=0
  for i in "${!labels[@]}"; do
    local index=$((i+1))
    local status="${RESULTS[$index]:-UNKNOWN}"
    if [ "$status" = "SUCCESS" ]; then
      success_count=$((success_count + 1))
    elif [ "$status" = "FAILED" ]; then
      fail_count=$((fail_count + 1))
    fi
    log "INFO" "  [$index] ${labels[$i]} — $status"
  done

  log "INFO" "  Succeeded: $success_count | Failed: $fail_count"

  [ "$fail_count" -eq 0 ]
}

# =============================================================================
# Execute work units with same-repo stacking (wave-based)
# =============================================================================
# When multiple units target the same repo, they are serialized into waves.
# Wave 1 runs the first unit per repo (parallel). Wave 2+ stacks subsequent
# units on the previous wave's feature branches. Different repos still run
# in parallel across waves.
execute_order_with_stacking() {
  local -a all_units=()
  local -a all_labels=()

  local reading_units=true
  for arg in "$@"; do
    if [ "$arg" = "--" ]; then
      reading_units=false
      continue
    fi
    if [ "$reading_units" = true ]; then
      all_units+=("$arg")
    else
      all_labels+=("$arg")
    fi
  done

  # Check if any repo appears more than once
  local needs_stacking=false
  local i j
  for ((i=0; i<${#all_units[@]}; i++)); do
    local repo_i
    repo_i=$(echo "${all_units[$i]}" | cut -d'|' -f2)
    for ((j=i+1; j<${#all_units[@]}; j++)); do
      local repo_j
      repo_j=$(echo "${all_units[$j]}" | cut -d'|' -f2)
      if [ "$repo_i" = "$repo_j" ]; then
        needs_stacking=true
        break 2
      fi
    done
  done

  if [ "$needs_stacking" = false ]; then
    execute_work_units "${all_units[@]}" "--" "${all_labels[@]}"
    return $?
  fi

  log "INFO" "Same-repo PRDs detected — enabling stacked branch execution"

  # Track which units have been dispatched
  local -a assigned=()
  for i in "${!all_units[@]}"; do
    assigned[$i]=0
  done

  local wave=0
  local overall_fail=0

  while true; do
    local -a wave_units=()
    local -a wave_labels=()
    local -a wave_repos_seen=()

    for i in "${!all_units[@]}"; do
      if [ "${assigned[$i]}" = "1" ]; then
        continue
      fi

      local repo_url
      repo_url=$(echo "${all_units[$i]}" | cut -d'|' -f2)

      # Skip if this repo already has a unit in this wave
      local repo_in_wave=false
      if [ ${#wave_repos_seen[@]} -gt 0 ]; then
        for wr in "${wave_repos_seen[@]}"; do
          if [ "$wr" = "$repo_url" ]; then
            repo_in_wave=true
            break
          fi
        done
      fi

      if [ "$repo_in_wave" = true ]; then
        continue
      fi

      local unit="${all_units[$i]}"

      # For waves after the first, read the previous feature branch and stack on it
      if [ $wave -gt 0 ]; then
        local repo_name
        repo_name=$(basename "$repo_url" .git)
        local marker="$WORK_DIR/$repo_name/.pipeline/feature-branch"
        if [ -f "$marker" ]; then
          local prev_branch
          prev_branch=$(cat "$marker")
          unit="${unit}|${prev_branch}"
          log "INFO" "Stacking on previous branch: $prev_branch (repo: $repo_name)"
        else
          log "WARN" "No feature-branch marker for $repo_name — branching from base (no stacking)"
        fi
      fi

      wave_units+=("$unit")
      wave_labels+=("${all_labels[$i]}")
      wave_repos_seen+=("$repo_url")
      assigned[$i]=1
    done

    if [ ${#wave_units[@]} -eq 0 ]; then
      break
    fi

    local wave_num=$((wave + 1))
    if [ $wave -gt 0 ]; then
      log "INFO" ""
      log "INFO" "--- Stacking wave $wave_num ---"
    fi

    set +e
    execute_work_units "${wave_units[@]}" "--" "${wave_labels[@]}"
    local wave_result=$?
    set -e

    if [ $wave_result -ne 0 ]; then
      overall_fail=$((overall_fail + 1))
    fi

    wave=$((wave + 1))
  done

  [ "$overall_fail" -eq 0 ]
}

# =============================================================================
# MANIFEST MODE
# =============================================================================
if [ -n "$MANIFEST_FILE" ]; then
  if ! command -v jq &> /dev/null; then
    log "ERROR" "jq is required for manifest mode. Install with: brew install jq"
    exit 1
  fi

  if [ ! -f "$MANIFEST_FILE" ]; then
    log "ERROR" "Manifest file not found: $MANIFEST_FILE"
    exit 1
  fi

  MANIFEST_FILE=$(realpath "$MANIFEST_FILE")
  MANIFEST_BASE=$(dirname "$MANIFEST_FILE")

  MANIFEST_NAME=$(jq -r '.name // "Unnamed"' "$MANIFEST_FILE")
  TOTAL_ORDERS=$(jq '.orders | length' "$MANIFEST_FILE")

  log "INFO" "============================================================"
  log "INFO" "  Coding Agents Pipeline — Manifest Orchestrator"
  log "INFO" "============================================================"
  log "INFO" "Manifest:  $MANIFEST_NAME"
  log "INFO" "Orders:    $TOTAL_ORDERS"
  log "INFO" "Agents:    $AGENTS"
  log "INFO" "Model:     $MODEL"
  log "INFO" "Max iter:  $MAX_ITERATIONS"
  log "INFO" "Parallel:  $([ "$SEQUENTIAL" = true ] && echo "no (sequential)" || echo "yes (max $MAX_PARALLEL)")"
  log "INFO" "============================================================"

  # Determine which orders to run
  START_ORDER=0
  END_ORDER=$((TOTAL_ORDERS - 1))

  if [ -n "$TARGET_ORDER" ]; then
    if [ "$TARGET_ORDER" -lt 1 ] || [ "$TARGET_ORDER" -gt "$TOTAL_ORDERS" ]; then
      log "ERROR" "Order $TARGET_ORDER is out of range (1-$TOTAL_ORDERS)"
      exit 1
    fi
    START_ORDER=$((TARGET_ORDER - 1))
    END_ORDER=$((TARGET_ORDER - 1))
  fi

  OVERALL_SUCCESS=0
  OVERALL_FAIL=0

  for ((order_idx=START_ORDER; order_idx<=END_ORDER; order_idx++)); do
    ORDER_NUM=$((order_idx + 1))
    ORDER_NAME=$(jq -r ".orders[$order_idx].name // \"Order $ORDER_NUM\"" "$MANIFEST_FILE")
    ORDER_DESC=$(jq -r ".orders[$order_idx].description // \"\"" "$MANIFEST_FILE")
    NUM_PRDS=$(jq ".orders[$order_idx].prds | length" "$MANIFEST_FILE")

    log "INFO" ""
    log "INFO" "============================================================"
    log "INFO" "  Order $ORDER_NUM/$TOTAL_ORDERS: $ORDER_NAME"
    if [ -n "$ORDER_DESC" ] && [ "$ORDER_DESC" != "" ]; then
      log "INFO" "  $ORDER_DESC"
    fi
    log "INFO" "============================================================"

    # Build work units for this order
    UNITS=()
    LABELS=()

    for ((prd_idx=0; prd_idx<NUM_PRDS; prd_idx++)); do
      PRD_REL=$(jq -r ".orders[$order_idx].prds[$prd_idx].prd" "$MANIFEST_FILE")
      PRD_ABS="$MANIFEST_BASE/$PRD_REL"

      if [ ! -f "$PRD_ABS" ]; then
        log "ERROR" "PRD not found: $PRD_ABS (from manifest: $PRD_REL)"
        exit 1
      fi
      PRD_ABS=$(realpath "$PRD_ABS")

      PRD_TITLE=$(parse_prd_title "$PRD_ABS")
      PRD_STATUS=$(parse_prd_status "$PRD_ABS")

      if [ "$PRD_STATUS" = "Done" ]; then
        log "INFO" "Skipping PRD '$PRD_TITLE' — status is Done"
        continue
      fi

      NUM_REPOS=$(jq ".orders[$order_idx].prds[$prd_idx].repositories | length" "$MANIFEST_FILE")
      PRD_AGENTS=$(jq -r ".orders[$order_idx].prds[$prd_idx].agents // [] | join(\",\")" "$MANIFEST_FILE")

      for ((repo_idx=0; repo_idx<NUM_REPOS; repo_idx++)); do
        REPO_URL=$(jq -r ".orders[$order_idx].prds[$prd_idx].repositories[$repo_idx].url" "$MANIFEST_FILE")
        BRANCH=$(jq -r ".orders[$order_idx].prds[$prd_idx].repositories[$repo_idx].branch // \"main\"" "$MANIFEST_FILE")
        CONTEXT_REL=$(jq -r ".orders[$order_idx].prds[$prd_idx].repositories[$repo_idx].context // \"\"" "$MANIFEST_FILE")
        REPO_AGENTS=$(jq -r ".orders[$order_idx].prds[$prd_idx].repositories[$repo_idx].agents // [] | join(\",\")" "$MANIFEST_FILE")

        CONTEXT_ABS=""
        if [ -n "$CONTEXT_REL" ] && [ "$CONTEXT_REL" != "" ]; then
          CONTEXT_ABS="$MANIFEST_BASE/$CONTEXT_REL"
          if [ -d "$CONTEXT_ABS" ]; then
            CONTEXT_ABS=$(realpath "$CONTEXT_ABS")
          elif [ -f "$CONTEXT_ABS" ]; then
            CONTEXT_ABS=$(realpath "$CONTEXT_ABS")
          else
            log "WARN" "Context not found: $CONTEXT_ABS (from manifest: $CONTEXT_REL)"
            CONTEXT_ABS=""
          fi
        fi

        if [ -n "$BRANCH_OVERRIDE" ]; then
          BRANCH="$BRANCH_OVERRIDE"
        fi
        if [ -n "$REPO_OVERRIDE" ]; then
          REPO_URL="$REPO_OVERRIDE"
        fi

        # Combine PRD-level + repo-level agents; fall back to global default
        if [ -n "$PRD_AGENTS" ] && [ -n "$REPO_AGENTS" ]; then
          UNIT_AGENTS="${PRD_AGENTS},${REPO_AGENTS}"
        elif [ -n "$PRD_AGENTS" ]; then
          UNIT_AGENTS="$PRD_AGENTS"
        elif [ -n "$REPO_AGENTS" ]; then
          UNIT_AGENTS="$REPO_AGENTS"
        else
          UNIT_AGENTS="$AGENTS"
        fi

        REPO_NAME=$(basename "$REPO_URL" .git)
        UNITS+=("${PRD_ABS}|${REPO_URL}|${BRANCH}|${CONTEXT_ABS}|${UNIT_AGENTS}")
        LABELS+=("'$PRD_TITLE' → $REPO_NAME ($BRANCH)")
      done
    done

    if [ ${#UNITS[@]} -eq 0 ]; then
      log "INFO" "No work units in this order (all PRDs are Done). Skipping."
      continue
    fi

    log "INFO" "Work units: ${#UNITS[@]}"
    for i in "${!LABELS[@]}"; do
      log "INFO" "  [$((i+1))] ${LABELS[$i]}"
    done

    # Execute this order's work units (with same-repo stacking when needed)
    set +e
    execute_order_with_stacking "${UNITS[@]}" "--" "${LABELS[@]}"
    order_result=$?
    set -e

    if [ $order_result -ne 0 ]; then
      OVERALL_FAIL=$((OVERALL_FAIL + 1))
      log "ERROR" "Order '$ORDER_NAME' had failures."
    else
      OVERALL_SUCCESS=$((OVERALL_SUCCESS + 1))
    fi

    # Pause between orders (if more orders remain)
    if [ $order_idx -lt $END_ORDER ]; then
      log "INFO" ""
      log "INFO" "------------------------------------------------------------"
      log "INFO" "  Order '$ORDER_NAME' complete."
      log "INFO" "  Review and merge the PRs above before the next order."
      log "INFO" "------------------------------------------------------------"

      if [ "$AUTO_CONTINUE" != true ] && [ -t 0 ]; then
        echo ""
        echo "  Press Enter to continue to the next order, or Ctrl+C to stop."
        echo "  (Resume later with: --manifest $MANIFEST_FILE --order $((ORDER_NUM + 1)))"
        echo ""
        read -r
      elif [ "$AUTO_CONTINUE" != true ]; then
        log "INFO" "Non-interactive mode — continuing to next order automatically."
      fi
    fi
  done

  # Final summary
  log "INFO" ""
  log "INFO" "============================================================"
  log "INFO" "  Manifest Complete: $MANIFEST_NAME"
  log "INFO" "============================================================"
  log "INFO" "Orders run: $((END_ORDER - START_ORDER + 1))"
  log "INFO" "Succeeded:  $OVERALL_SUCCESS | Failed: $OVERALL_FAIL"
  log "INFO" "Logs:       $LOG_DIR/"
  log "INFO" "Work dir:   $WORK_DIR/"
  log "INFO" "============================================================"

  [ "$OVERALL_FAIL" -eq 0 ]
  exit $?
fi

# =============================================================================
# LEGACY MODE (--prd / --prd-dir)
# =============================================================================

# Collect PRD files
if [ -n "$PRD_DIR" ]; then
  while IFS= read -r file; do
    PRD_FILES+=("$file")
  done < <(collect_prd_files "$PRD_DIR")
fi

if [ ${#PRD_FILES[@]} -eq 0 ]; then
  log "ERROR" "No PRD files specified. Use --manifest, --prd <file>, or --prd-dir <directory>."
  exit 1
fi

log "INFO" "============================================================"
log "INFO" "  Coding Agents Pipeline — Legacy Orchestrator"
log "INFO" "============================================================"
log "INFO" "PRDs:            ${#PRD_FILES[@]} file(s)"
log "INFO" "Repo override:   ${REPO_OVERRIDE:-<from PRD metadata>}"
log "INFO" "Branch override: ${BRANCH_OVERRIDE:-<from PRD metadata>}"
log "INFO" "Agents:          $AGENTS"
log "INFO" "Model:           $MODEL"
log "INFO" "Max iterations:  $MAX_ITERATIONS"
log "INFO" "Execution:       $([ "$SEQUENTIAL" = true ] && echo "sequential" || echo "parallel (max $MAX_PARALLEL)")"
log "INFO" "============================================================"

# Build work units from PRD metadata (legacy path)
UNITS=()
LABELS=()

for prd_file in "${PRD_FILES[@]}"; do
  prd_file=$(realpath "$prd_file")
  prd_title=$(parse_prd_title "$prd_file")
  prd_status=$(parse_prd_status "$prd_file")

  if [ "$prd_status" = "Done" ]; then
    log "INFO" "Skipping PRD '$prd_title' — status is Done"
    continue
  fi

  if [ -n "$REPO_OVERRIDE" ]; then
    branch="${BRANCH_OVERRIDE:-main}"
    context="${CONTEXT_FILE:-}"
    UNITS+=("${prd_file}|${REPO_OVERRIDE}|${branch}|${context}")
    LABELS+=("'$prd_title' → $(basename "$REPO_OVERRIDE" .git) ($branch)")
  else
    while IFS= read -r repo_entry; do
      repo_url=$(echo "$repo_entry" | cut -d'|' -f1)
      branch=$(echo "$repo_entry" | cut -d'|' -f2)
      [ -n "$BRANCH_OVERRIDE" ] && branch="$BRANCH_OVERRIDE"
      context="${CONTEXT_FILE:-}"
      UNITS+=("${prd_file}|${repo_url}|${branch}|${context}")
      LABELS+=("'$prd_title' → $(basename "$repo_url" .git) ($branch)")
    done < <(parse_prd_repositories "$prd_file")

    if ! parse_prd_repositories "$prd_file" | grep -q '.'; then
      log "ERROR" "PRD '$prd_title' has no target repositories. Use --repo or add a '## Target Repositories' table."
      exit 1
    fi
  fi
done

if [ ${#UNITS[@]} -eq 0 ]; then
  log "ERROR" "No work units to process."
  exit 1
fi

log "INFO" ""
log "INFO" "Work units: ${#UNITS[@]}"
for i in "${!LABELS[@]}"; do
  log "INFO" "  [$((i+1))] ${LABELS[$i]}"
done
log "INFO" ""

set +e
execute_order_with_stacking "${UNITS[@]}" "--" "${LABELS[@]}"
result=$?
set -e

log "INFO" ""
log "INFO" "============================================================"
log "INFO" "  Pipeline Complete"
log "INFO" "============================================================"
log "INFO" "Logs:     $LOG_DIR/"
log "INFO" "Work dir: $WORK_DIR/"
log "INFO" "============================================================"

exit $result
