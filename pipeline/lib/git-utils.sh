#!/bin/bash
# Git utilities for the pipeline.

# Set by clone_or_prepare_repo when the remote has no branches (virgin repo).
# Consumers should check this after calling clone_or_prepare_repo.
REPO_WAS_EMPTY=false

clone_or_prepare_repo() {
  local repo_url="$1"
  local workdir="$2"
  local base_branch="${3:-main}"

  if [ -d "$workdir/.git" ]; then
    log "INFO" "Repository already exists at $workdir, fetching latest..."
    cd "$workdir" || exit 1
    git fetch origin

    if ! git rev-parse HEAD &>/dev/null; then
      _seed_empty_repo "$workdir" "$base_branch" "$repo_url"
    else
      git checkout "$base_branch" 2>/dev/null || true
      git pull origin "$base_branch" 2>/dev/null || true
    fi
  else
    log "INFO" "Cloning $repo_url into $workdir..."
    mkdir -p "$(dirname "$workdir")"
    git clone "$repo_url" "$workdir" 2>&1 || {
      log "WARN" "Clone failed — initializing new local repository"
      mkdir -p "$workdir"
      cd "$workdir" || exit 1
      git init
      git remote add origin "$repo_url"
      _seed_empty_repo "$workdir" "$base_branch" "$repo_url"
      return
    }
    cd "$workdir" || exit 1

    if ! git rev-parse HEAD &>/dev/null; then
      _seed_empty_repo "$workdir" "$base_branch" "$repo_url"
    else
      git checkout "$base_branch" 2>/dev/null || git checkout -b "$base_branch"
    fi
  fi
}

_seed_empty_repo() {
  local workdir="$1"
  local base_branch="$2"
  local repo_url="$3"

  cd "$workdir" || exit 1
  log "INFO" "Empty repository detected — seeding $base_branch with initial commit"
  git checkout -b "$base_branch" 2>/dev/null || git checkout "$base_branch"
  git commit --allow-empty -m "chore: initialize repository"
  git push -u origin "$base_branch" 2>/dev/null || {
    log "WARN" "Could not push $base_branch to origin (will retry at PR time)"
  }
  REPO_WAS_EMPTY=true
}

create_feature_branch() {
  local workdir="$1"
  local branch_name="$2"

  cd "$workdir" || exit 1

  if git show-ref --verify --quiet "refs/heads/$branch_name"; then
    log "INFO" "Branch $branch_name already exists, checking out..."
    git checkout "$branch_name"
  else
    log "INFO" "Creating branch $branch_name..."
    git checkout -b "$branch_name"
  fi
}

generate_branch_name() {
  local prd_file="$1"
  local prd_slug

  prd_slug=$(grep '^# ' "$prd_file" 2>/dev/null | head -1 | sed 's/^# //' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-50)

  if [ -z "$prd_slug" ]; then
    prd_slug=$(basename "$prd_file" .md | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')
  fi

  local date_stamp
  date_stamp=$(date +%Y%m%d)
  echo "agent/${prd_slug}-${date_stamp}"
}

rebase_onto_latest() {
  local workdir="$1"
  local target_branch="$2"

  cd "$workdir" || exit 1
  git fetch origin "$target_branch" 2>/dev/null || {
    log "WARN" "Could not fetch origin/$target_branch — skipping rebase"
    return 0
  }

  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD)

  if git merge-base --is-ancestor "origin/$target_branch" HEAD 2>/dev/null; then
    log "INFO" "Branch $current_branch is already up to date with origin/$target_branch"
    return 0
  fi

  log "INFO" "Rebasing $current_branch onto origin/$target_branch..."
  if ! git rebase "origin/$target_branch" 2>/dev/null; then
    log "WARN" "Rebase failed — aborting rebase (PR may show conflicts on GitHub)"
    git rebase --abort 2>/dev/null || true
    return 1
  fi

  log "INFO" "Rebase onto origin/$target_branch successful"
  return 0
}

create_pull_request() {
  local workdir="$1"
  local base_branch="$2"
  local prd_slug="$3"
  local pr_description_file="$workdir/docs/architecture/$prd_slug/pr-description.md"

  cd "$workdir" || exit 1

  git push -u origin HEAD

  local pr_title
  pr_title=$(head -1 "$pr_description_file" 2>/dev/null | sed 's/^## //' || echo "feat: $prd_slug")

  local pr_body=""
  if [ -f "$pr_description_file" ]; then
    pr_body=$(cat "$pr_description_file")
  else
    pr_body="Automated PR created by Coding Agents Pipeline.\n\nSee docs/architecture/$prd_slug/ for details."
  fi

  gh pr create \
    --base "$base_branch" \
    --title "$pr_title" \
    --body "$pr_body"
}

# Post agent report files as PR comments for evidence/traceability.
# Args: workdir, pr_url, prd_slug, comma-separated agent list
post_pr_evidence() {
  local workdir="$1"
  local pr_url="$2"
  local prd_slug="$3"
  local agents="$4"

  IFS=',' read -ra agent_list <<< "$agents"
  for agent in "${agent_list[@]}"; do
    agent=$(echo "$agent" | xargs)
    local report_file=""
    case "$agent" in
      tester)         report_file="$workdir/docs/architecture/$prd_slug/test-report.md" ;;
      secops)         report_file="$workdir/docs/architecture/$prd_slug/security-report.md" ;;
      infrastructure) report_file="$workdir/docs/architecture/$prd_slug/infrastructure.md" ;;
      devops)         report_file="$workdir/docs/architecture/$prd_slug/devops.md" ;;
    esac

    if [ -n "$report_file" ] && [ -f "$report_file" ]; then
      local header
      header=$(echo "$agent" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
      local body
      body=$(printf "## %s Report\n\n%s" "$header" "$(cat "$report_file")")
      gh pr comment "$pr_url" --body "$body" 2>/dev/null || {
        log "WARN" "Failed to post $agent evidence comment on PR"
      }
    fi
  done
}
