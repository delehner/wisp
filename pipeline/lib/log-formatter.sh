#!/bin/bash
# =============================================================================
# log-formatter.sh — Formats Claude Code stream-json output into readable logs
# =============================================================================
# Reads newline-delimited JSON from stdin (Claude Code --output-format stream-json)
# and writes human-readable formatted output to stdout.
#
# Handles two event styles:
#   - Complete messages (without --include-partial-messages): type=assistant, type=user, etc.
#   - Streaming deltas (with --include-partial-messages): type=stream_event with nested deltas
#
# Requires: jq (falls back to raw passthrough if unavailable)
#
# Usage:
#   claude -p "..." --output-format stream-json --verbose 2>&1 | ./log-formatter.sh
#   claude -p "..." --output-format stream-json --verbose 2>&1 | ./log-formatter.sh --raw-log out.jsonl

RAW_LOG=""
TRUNCATE_LIMIT=500

while [[ $# -gt 0 ]]; do
  case $1 in
    --raw-log) RAW_LOG="$2"; shift 2 ;;
    --truncate) TRUNCATE_LIMIT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# --- Color support ---
if [ -t 1 ]; then
  C_RESET='\033[0m'
  C_DIM='\033[2m'
  C_BOLD='\033[1m'
  C_CYAN='\033[36m'
  C_YELLOW='\033[33m'
  C_GREEN='\033[32m'
  C_BLUE='\033[34m'
  C_MAGENTA='\033[35m'
  C_RED='\033[31m'
else
  C_RESET='' C_DIM='' C_BOLD='' C_CYAN='' C_YELLOW=''
  C_GREEN='' C_BLUE='' C_MAGENTA='' C_RED=''
fi

# --- Check for jq ---
if ! command -v jq &>/dev/null; then
  echo "[log-formatter] WARNING: jq not found — streaming raw output" >&2
  if [ -n "$RAW_LOG" ]; then
    tee "$RAW_LOG"
  else
    cat
  fi
  exit 0
fi

# Track state for streaming deltas
current_block_type=""

format_line() {
  local line="$1"

  # Save raw JSON if requested
  if [ -n "$RAW_LOG" ]; then
    echo "$line" >> "$RAW_LOG"
  fi

  # Skip empty lines
  if [ -z "$line" ]; then
    return
  fi

  # Try to detect if this is JSON
  local event_type
  event_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

  if [ -z "$event_type" ]; then
    # Not JSON — pass through (stderr messages, etc.)
    echo "$line"
    return
  fi

  case "$event_type" in

    # --- Session initialization ---
    init|system)
      local session_id subtype
      session_id=$(echo "$line" | jq -r '.session_id // empty' 2>/dev/null)
      subtype=$(echo "$line" | jq -r '.subtype // empty' 2>/dev/null)
      if [ -n "$session_id" ]; then
        echo ""
        echo -e "${C_BOLD}${C_CYAN}--- Session: ${session_id} ---${C_RESET}"
        echo ""
      fi
      ;;

    # --- Complete assistant message (without --include-partial-messages) ---
    assistant)
      local content_blocks
      content_blocks=$(echo "$line" | jq -c '.message.content[]?' 2>/dev/null)

      while IFS= read -r block; do
        [ -z "$block" ] && continue
        local block_type
        block_type=$(echo "$block" | jq -r '.type // empty' 2>/dev/null)

        case "$block_type" in
          thinking)
            local thinking
            thinking=$(echo "$block" | jq -r '.thinking // empty' 2>/dev/null)
            if [ -n "$thinking" ]; then
              echo ""
              echo -e "${C_DIM}${C_MAGENTA}[THINKING]${C_RESET}"
              echo -e "${C_DIM}${thinking}${C_RESET}"
              echo -e "${C_DIM}${C_MAGENTA}[/THINKING]${C_RESET}"
            fi
            ;;
          text)
            local text
            text=$(echo "$block" | jq -r '.text // empty' 2>/dev/null)
            if [ -n "$text" ]; then
              echo ""
              echo -e "${C_GREEN}[OUTPUT]${C_RESET}"
              echo "$text"
            fi
            ;;
          tool_use)
            local tool_name tool_id tool_input
            tool_name=$(echo "$block" | jq -r '.name // empty' 2>/dev/null)
            tool_id=$(echo "$block" | jq -r '.id // empty' 2>/dev/null)
            tool_input=$(echo "$block" | jq -r '.input // {} | tostring' 2>/dev/null)
            if [ ${#tool_input} -gt "$TRUNCATE_LIMIT" ]; then
              tool_input="${tool_input:0:$TRUNCATE_LIMIT}... (truncated)"
            fi
            echo ""
            echo -e "${C_YELLOW}[TOOL] ${C_BOLD}${tool_name}${C_RESET}"
            echo -e "${C_DIM}${tool_input}${C_RESET}"
            ;;
        esac
      done <<< "$content_blocks"
      ;;

    # --- User message (tool results) ---
    user)
      local content_blocks
      content_blocks=$(echo "$line" | jq -c '.message.content[]?' 2>/dev/null)

      while IFS= read -r block; do
        [ -z "$block" ] && continue
        local block_type
        block_type=$(echo "$block" | jq -r '.type // empty' 2>/dev/null)

        if [ "$block_type" = "tool_result" ]; then
          local is_error result_preview
          is_error=$(echo "$block" | jq -r '.is_error // false' 2>/dev/null)

          result_preview=$(echo "$block" | jq -r '
            if .content | type == "string" then .content
            elif .content | type == "array" then (.content | map(select(.type == "text") | .text) | join("\n"))
            else (.content | tostring)
            end' 2>/dev/null)

          if [ ${#result_preview} -gt "$TRUNCATE_LIMIT" ]; then
            result_preview="${result_preview:0:$TRUNCATE_LIMIT}... (truncated)"
          fi

          if [ "$is_error" = "true" ]; then
            echo -e "${C_RED}[RESULT] (error)${C_RESET}"
          else
            echo -e "${C_BLUE}[RESULT]${C_RESET}"
          fi
          echo -e "${C_DIM}${result_preview}${C_RESET}"
        fi
      done <<< "$content_blocks"
      ;;

    # --- Streaming event (with --include-partial-messages) ---
    stream_event)
      local inner_type
      inner_type=$(echo "$line" | jq -r '.event.type // empty' 2>/dev/null)

      case "$inner_type" in
        content_block_start)
          current_block_type=$(echo "$line" | jq -r '.event.content_block.type // empty' 2>/dev/null)
          case "$current_block_type" in
            thinking)
              echo ""
              echo -ne "${C_DIM}${C_MAGENTA}[THINKING] ${C_RESET}${C_DIM}"
              ;;
            text)
              echo ""
              echo -ne "${C_GREEN}[OUTPUT] ${C_RESET}"
              ;;
            tool_use)
              local tool_name
              tool_name=$(echo "$line" | jq -r '.event.content_block.name // empty' 2>/dev/null)
              echo ""
              echo -e "${C_YELLOW}[TOOL] ${C_BOLD}${tool_name}${C_RESET}"
              ;;
          esac
          ;;

        content_block_delta)
          local delta_type delta_text
          delta_type=$(echo "$line" | jq -r '.event.delta.type // empty' 2>/dev/null)

          case "$delta_type" in
            thinking_delta)
              delta_text=$(echo "$line" | jq -rj '.event.delta.thinking // empty' 2>/dev/null)
              echo -ne "${C_DIM}${delta_text}${C_RESET}"
              ;;
            text_delta)
              delta_text=$(echo "$line" | jq -rj '.event.delta.text // empty' 2>/dev/null)
              echo -n "$delta_text"
              ;;
            input_json_delta)
              delta_text=$(echo "$line" | jq -rj '.event.delta.partial_json // empty' 2>/dev/null)
              echo -ne "${C_DIM}${delta_text}${C_RESET}"
              ;;
          esac
          ;;

        content_block_stop)
          if [ "$current_block_type" = "thinking" ]; then
            echo -e "${C_RESET}"
            echo -e "${C_DIM}${C_MAGENTA}[/THINKING]${C_RESET}"
          else
            echo ""
          fi
          current_block_type=""
          ;;

        message_start|message_delta|message_stop)
          ;;
      esac
      ;;

    # --- Final result ---
    result)
      local cost duration num_turns is_error session_id
      cost=$(echo "$line" | jq -r '.cost_usd // "unknown"' 2>/dev/null)
      duration=$(echo "$line" | jq -r '.duration_ms // empty' 2>/dev/null)
      num_turns=$(echo "$line" | jq -r '.num_turns // empty' 2>/dev/null)
      is_error=$(echo "$line" | jq -r '.is_error // false' 2>/dev/null)
      session_id=$(echo "$line" | jq -r '.session_id // empty' 2>/dev/null)

      local duration_str=""
      if [ -n "$duration" ] && [ "$duration" != "null" ]; then
        local secs=$((duration / 1000))
        local mins=$((secs / 60))
        local remaining_secs=$((secs % 60))
        if [ "$mins" -gt 0 ]; then
          duration_str="${mins}m ${remaining_secs}s"
        else
          duration_str="${secs}s"
        fi
      fi

      echo ""
      if [ "$is_error" = "true" ]; then
        echo -e "${C_RED}${C_BOLD}--- Session Error ---${C_RESET}"
      else
        echo -e "${C_CYAN}${C_BOLD}--- Session Complete ---${C_RESET}"
      fi
      echo -e "${C_DIM}  Cost: \$${cost} | Duration: ${duration_str:-unknown} | Turns: ${num_turns:-unknown} | Session: ${session_id:-unknown}${C_RESET}"
      echo ""
      ;;

    *)
      # Unknown event type — pass through as dimmed text
      echo -e "${C_DIM}[${event_type}] $(echo "$line" | jq -c '.' 2>/dev/null || echo "$line")${C_RESET}"
      ;;
  esac
}

# --- Main loop: read lines from stdin ---
while IFS= read -r line; do
  format_line "$line"
done
