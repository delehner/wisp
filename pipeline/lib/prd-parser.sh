#!/bin/bash
# Parse PRD metadata: extract target repositories, branches, and status.
#
# PRD format for repositories (legacy — manifests are now preferred):
#   ## Target Repositories
#   | Repository | Branch |
#   |-----------|--------|
#   | https://github.com/org/repo1 | main |
#   | https://github.com/org/repo2 | develop |
#
# Legacy single-repo format (also supported):
#   > **Target Repository**: https://github.com/org/repo
#   > **Target Branch**: main

parse_prd_repositories() {
  local prd_file="$1"
  local repos=()

  # Try multi-repo table format first:
  # Look for lines matching "| https://... | branch |"
  while IFS= read -r line; do
    local repo branch
    repo=$(echo "$line" | sed -n 's/.*| *\(https:\/\/[^ |]*\) *|.*/\1/p')
    branch=$(echo "$line" | sed -n 's/.*| *https:\/\/[^ |]* *| *\([^ |]*\) *|.*/\1/p')

    if [ -n "$repo" ]; then
      branch="${branch:-main}"
      repo=$(echo "$repo" | xargs)
      branch=$(echo "$branch" | xargs)
      repos+=("${repo}|${branch}")
    fi
  done < "$prd_file"

  # Fall back to legacy single-repo format
  if [ ${#repos[@]} -eq 0 ]; then
    local single_repo single_branch
    single_repo=$(grep '**Target Repository**' "$prd_file" 2>/dev/null | sed 's/.*\*\*Target Repository\*\*:[[:space:]]*//' | xargs || true)
    single_branch=$(grep '**Target Branch**' "$prd_file" 2>/dev/null | sed 's/.*\*\*Target Branch\*\*:[[:space:]]*//' | xargs || true)

    if [ -n "$single_repo" ]; then
      single_branch="${single_branch:-main}"
      repos+=("${single_repo}|${single_branch}")
    fi
  fi

  for entry in "${repos[@]}"; do
    echo "$entry"
  done
}

parse_prd_status() {
  local prd_file="$1"
  grep '**Status**' "$prd_file" 2>/dev/null | head -1 | sed 's/.*\*\*Status\*\*:[[:space:]]*//' | xargs || echo "Unknown"
}

parse_prd_title() {
  local prd_file="$1"
  grep '^# ' "$prd_file" 2>/dev/null | head -1 | sed 's/^# //' || basename "$prd_file" .md
}

parse_prd_priority() {
  local prd_file="$1"
  grep '**Priority**' "$prd_file" 2>/dev/null | head -1 | sed 's/.*\*\*Priority\*\*:[[:space:]]*//' | xargs || echo "P2"
}

parse_prd_working_branch() {
  local prd_file="$1"
  grep '**Working Branch**' "$prd_file" 2>/dev/null | head -1 \
    | sed 's/.*\*\*Working Branch\*\*:[[:space:]]*//' | xargs || echo ""
}

collect_prd_files() {
  local input="$1"

  if [ -d "$input" ]; then
    find "$input" -maxdepth 1 -name '*.md' -type f | sort
  elif [ -f "$input" ]; then
    echo "$input"
  else
    local expanded
    expanded=$(ls $input 2>/dev/null || true)
    if [ -n "$expanded" ]; then
      echo "$expanded"
    fi
  fi
}
