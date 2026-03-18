#!/bin/bash
# =============================================================================
# log-formatter.sh — Formats AI CLI stream-json output into readable logs
# =============================================================================
# Reads newline-delimited JSON from stdin (--output-format stream-json) and
# writes human-readable formatted output to stdout.
#
# Supports both Claude Code and Gemini CLI stream-json formats.
# Use --provider to specify (auto-detects if omitted).
#
# Requires: jq (falls back to raw passthrough if unavailable)
#
# Usage:
#   <cli> -p "..." --output-format stream-json 2>&1 | ./log-formatter.sh [--provider claude|gemini]
#   <cli> -p "..." --output-format stream-json 2>&1 | ./log-formatter.sh --raw-log out.jsonl

RAW_LOG=""
TRUNCATE_LIMIT=500
PROVIDER=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --raw-log) RAW_LOG="$2"; shift 2 ;;
    --truncate) TRUNCATE_LIMIT="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
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

# =============================================================================
# Claude Code event formatting
# =============================================================================
format_claude_event() {
  local line="$1"
  local event_type="$2"

  case "$event_type" in

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
      echo -e "${C_DIM}[${event_type}] $(echo "$line" | jq -c '.' 2>/dev/null || echo "$line")${C_RESET}"
      ;;
  esac
}

# =============================================================================
# Gemini CLI event formatting
# =============================================================================
format_gemini_event() {
  local line="$1"
  local event_type="$2"

  case "$event_type" in

    thought)
      local content
      content=$(echo "$line" | jq -r '.content // empty' 2>/dev/null)
      if [ -n "$content" ]; then
        echo ""
        echo -e "${C_DIM}${C_MAGENTA}[THINKING]${C_RESET}"
        echo -e "${C_DIM}${content}${C_RESET}"
        echo -e "${C_DIM}${C_MAGENTA}[/THINKING]${C_RESET}"
      fi
      ;;

    text)
      local content
      content=$(echo "$line" | jq -r '.content // empty' 2>/dev/null)
      if [ -n "$content" ]; then
        echo ""
        echo -e "${C_GREEN}[OUTPUT]${C_RESET}"
        echo "$content"
      fi
      ;;

    tool_call|tool_use|functionCall)
      local tool_name tool_input
      tool_name=$(echo "$line" | jq -r '.name // .toolName // .functionCall.name // empty' 2>/dev/null)
      tool_input=$(echo "$line" | jq -r '.input // .args // .functionCall.args // {} | tostring' 2>/dev/null)
      if [ ${#tool_input} -gt "$TRUNCATE_LIMIT" ]; then
        tool_input="${tool_input:0:$TRUNCATE_LIMIT}... (truncated)"
      fi
      echo ""
      echo -e "${C_YELLOW}[TOOL] ${C_BOLD}${tool_name}${C_RESET}"
      echo -e "${C_DIM}${tool_input}${C_RESET}"
      ;;

    tool_result|functionResponse)
      local result_preview is_error
      result_preview=$(echo "$line" | jq -r '.content // .result // .response // . | tostring' 2>/dev/null)
      is_error=$(echo "$line" | jq -r '.is_error // .error // false' 2>/dev/null)
      if [ ${#result_preview} -gt "$TRUNCATE_LIMIT" ]; then
        result_preview="${result_preview:0:$TRUNCATE_LIMIT}... (truncated)"
      fi
      if [ "$is_error" = "true" ]; then
        echo -e "${C_RED}[RESULT] (error)${C_RESET}"
      else
        echo -e "${C_BLUE}[RESULT]${C_RESET}"
      fi
      echo -e "${C_DIM}${result_preview}${C_RESET}"
      ;;

    result|done|complete)
      # Final result with stats
      local total_tokens latency_ms tool_calls session_id
      total_tokens=$(echo "$line" | jq -r '.stats.models // {} | to_entries | map(.value.tokens.total // 0) | add // "unknown"' 2>/dev/null)
      latency_ms=$(echo "$line" | jq -r '.stats.models // {} | to_entries | map(.value.api.totalLatencyMs // 0) | add // empty' 2>/dev/null)
      tool_calls=$(echo "$line" | jq -r '.stats.tools.totalCalls // "unknown"' 2>/dev/null)
      session_id=$(echo "$line" | jq -r '.sessionId // .session_id // empty' 2>/dev/null)

      local duration_str=""
      if [ -n "$latency_ms" ] && [ "$latency_ms" != "null" ]; then
        local secs=$((latency_ms / 1000))
        local mins=$((secs / 60))
        local remaining_secs=$((secs % 60))
        if [ "$mins" -gt 0 ]; then
          duration_str="${mins}m ${remaining_secs}s"
        else
          duration_str="${secs}s"
        fi
      fi

      echo ""
      echo -e "${C_CYAN}${C_BOLD}--- Session Complete ---${C_RESET}"
      echo -e "${C_DIM}  Tokens: ${total_tokens} | Duration: ${duration_str:-unknown} | Tool calls: ${tool_calls} | Session: ${session_id:-unknown}${C_RESET}"
      echo ""
      ;;

    *)
      echo -e "${C_DIM}[${event_type}] $(echo "$line" | jq -c '.' 2>/dev/null || echo "$line")${C_RESET}"
      ;;
  esac
}

# =============================================================================
# Auto-detect provider from JSON event structure
# =============================================================================
detect_provider() {
  local line="$1"

  # Claude events have .message.content[] or .event.type (stream_event)
  if echo "$line" | jq -e '.message.content // .event.type // .cost_usd' &>/dev/null; then
    echo "claude"
    return
  fi

  # Claude init/system events have session_id at top level with type=init|system
  local event_type
  event_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
  if [ "$event_type" = "init" ] || [ "$event_type" = "system" ] || [ "$event_type" = "stream_event" ]; then
    echo "claude"
    return
  fi

  # Gemini events use "thought", "text", "tool_call", or have .stats.models
  if [ "$event_type" = "thought" ] || [ "$event_type" = "tool_call" ] || [ "$event_type" = "functionCall" ]; then
    echo "gemini"
    return
  fi

  if echo "$line" | jq -e '.stats.models' &>/dev/null; then
    echo "gemini"
    return
  fi

  echo ""
}

# =============================================================================
# Main format dispatcher
# =============================================================================
format_line() {
  local line="$1"

  if [ -n "$RAW_LOG" ]; then
    echo "$line" >> "$RAW_LOG"
  fi

  if [ -z "$line" ]; then
    return
  fi

  local event_type
  event_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

  if [ -z "$event_type" ]; then
    echo "$line"
    return
  fi

  # Auto-detect provider on first JSON event if not specified
  if [ -z "$PROVIDER" ]; then
    PROVIDER=$(detect_provider "$line")
  fi

  case "$PROVIDER" in
    claude) format_claude_event "$line" "$event_type" ;;
    gemini) format_gemini_event "$line" "$event_type" ;;
    *)
      # Fallback: try both, prefer Claude (existing behavior)
      format_claude_event "$line" "$event_type"
      ;;
  esac
}

# --- Main loop: read lines from stdin ---
while IFS= read -r line; do
  format_line "$line"
done
