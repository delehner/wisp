#!/bin/bash
# =============================================================================
# context.sh — Context skill assembly utilities
# =============================================================================
# Assembles directory-based context skills into a single context file
# (CLAUDE.md or GEMINI.md depending on the AI provider).
# Supports both single-file and directory-based contexts.

# Defines the canonical ordering for context skill files.
# Files not in this list are appended alphabetically after the known ones.
CONTEXT_SKILL_ORDER=(
  overview
  architecture
  conventions
  components
  api
  database
  testing
  build-deploy
  environment
  integrations
)

# assemble_context_skills <context_dir> <output_file>
#
# Concatenates all .md files from a context directory into a single file,
# respecting the canonical skill ordering. Files not in the ordering list
# are appended alphabetically after the known ones.
assemble_context_skills() {
  local context_dir="$1"
  local output_file="$2"
  local ordered_files=()
  local remaining_files=()

  # Collect files in canonical order
  for skill_name in "${CONTEXT_SKILL_ORDER[@]}"; do
    if [ -f "$context_dir/${skill_name}.md" ]; then
      ordered_files+=("$context_dir/${skill_name}.md")
    fi
  done

  # Collect remaining .md files not in the canonical order
  while IFS= read -r -d '' file; do
    local basename
    basename=$(basename "$file" .md)
    local found=false
    for skill_name in "${CONTEXT_SKILL_ORDER[@]}"; do
      if [ "$basename" = "$skill_name" ]; then
        found=true
        break
      fi
    done
    if [ "$found" = false ]; then
      remaining_files+=("$file")
    fi
  done < <(find "$context_dir" -maxdepth 1 -name '*.md' -print0 | sort -z)

  local all_files=()
  if [ ${#ordered_files[@]} -gt 0 ]; then
    all_files+=("${ordered_files[@]}")
  fi
  if [ ${#remaining_files[@]} -gt 0 ]; then
    all_files+=("${remaining_files[@]}")
  fi

  if [ ${#all_files[@]} -eq 0 ]; then
    echo "# Project Context" > "$output_file"
    echo "" >> "$output_file"
    echo "No context skills found in: $context_dir" >> "$output_file"
    return 0
  fi

  # Assemble: strip YAML frontmatter from each file and concatenate
  > "$output_file"
  local first=true
  for file in "${all_files[@]}"; do
    if [ "$first" = true ]; then
      first=false
    else
      echo "" >> "$output_file"
      echo "---" >> "$output_file"
      echo "" >> "$output_file"
    fi
    strip_frontmatter "$file" >> "$output_file"
  done
}

# strip_frontmatter <file>
#
# Outputs the contents of a markdown file with YAML frontmatter removed.
# Frontmatter is a block delimited by --- at the start of the file.
strip_frontmatter() {
  local file="$1"
  local in_frontmatter=false
  local frontmatter_ended=false
  local line_num=0

  while IFS= read -r line || [ -n "$line" ]; do
    line_num=$((line_num + 1))
    if [ "$line_num" -eq 1 ] && [ "$line" = "---" ]; then
      in_frontmatter=true
      continue
    fi
    if [ "$in_frontmatter" = true ] && [ "$line" = "---" ]; then
      in_frontmatter=false
      frontmatter_ended=true
      continue
    fi
    if [ "$in_frontmatter" = true ]; then
      continue
    fi
    # Skip leading blank line right after frontmatter
    if [ "$frontmatter_ended" = true ] && [ -z "$line" ]; then
      frontmatter_ended=false
      continue
    fi
    frontmatter_ended=false
    echo "$line"
  done < "$file"
}

# is_context_directory <path>
#
# Returns 0 if the path is a directory (context skills), 1 if it's a file.
is_context_directory() {
  [ -d "$1" ]
}
