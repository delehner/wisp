#!/bin/bash
set -euo pipefail

# =============================================================================
# monitor.sh — Real-time log monitor for running agents
# =============================================================================
# Tails agent logs in real-time, with optional filtering by agent name.
# Works with both text (.log) and verbose JSON (.jsonl) logs.
#
# Usage:
#   ./pipeline/monitor.sh                           # tail all logs
#   ./pipeline/monitor.sh --agent developer         # tail only developer logs
#   ./pipeline/monitor.sh --log-dir /path/to/logs   # custom log directory
#   ./pipeline/monitor.sh --raw                     # tail raw .jsonl files
#   ./pipeline/monitor.sh --sessions                # list available session IDs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load provider for resume hints
if [ -f "$SCRIPT_DIR/lib/provider.sh" ]; then
  source "$SCRIPT_DIR/lib/provider.sh"
fi

LOG_DIR="${LOG_DIR:-./logs}"
AGENT_FILTER=""
RAW_MODE=false
LIST_SESSIONS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --log-dir) LOG_DIR="$2"; shift 2 ;;
    --agent) AGENT_FILTER="$2"; shift 2 ;;
    --raw) RAW_MODE=true; shift ;;
    --sessions) LIST_SESSIONS=true; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: monitor.sh [options]

Options:
  --log-dir <path>     Log directory to monitor (default: ./logs)
  --agent <name>       Filter logs by agent name (e.g. developer, tester)
  --raw                Tail raw .jsonl files instead of formatted .log files
  --sessions           List available session IDs for --resume

Examples:
  ./pipeline/monitor.sh                              # tail all active logs
  ./pipeline/monitor.sh --agent developer            # watch developer only
  ./pipeline/monitor.sh --sessions                   # list resumable sessions
  claude --resume <session-id>                       # resume a Claude session
  gemini --resume <session-id>                       # resume a Gemini session

HELP
      exit 0
      ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ ! -d "$LOG_DIR" ]; then
  echo "Log directory not found: $LOG_DIR"
  echo "Is the pipeline running? Start it with --verbose-logs to capture detailed output."
  exit 1
fi

# --- List sessions mode ---
if [ "$LIST_SESSIONS" = true ]; then
  local cli_name
  cli_name=$(provider_cli 2>/dev/null || echo "claude")
  echo "Available session IDs (for: $cli_name --resume <id>):"
  echo ""

  found=false
  for session_file in "$LOG_DIR"/*.session; do
    [ -f "$session_file" ] || continue
    found=true
    local_name=$(basename "$session_file" .session)
    session_id=$(cat "$session_file")
    timestamp=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$session_file" 2>/dev/null || stat -c "%y" "$session_file" 2>/dev/null | cut -d. -f1)
    echo "  $local_name"
    echo "    Session: $session_id"
    echo "    Time:    $timestamp"
    echo "    Resume:  $(provider_resume_hint "$session_id" 2>/dev/null || echo "$cli_name --resume $session_id")"
    echo ""
  done

  if [ "$found" = false ]; then
    echo "  No session files found."
    echo "  Run the pipeline with --verbose-logs to capture session IDs."
  fi
  exit 0
fi

# --- Determine which files to tail ---
if [ "$RAW_MODE" = true ]; then
  ext="jsonl"
else
  ext="log"
fi

# Build the file pattern
if [ -n "$AGENT_FILTER" ]; then
  pattern="${AGENT_FILTER}_*.$ext"
else
  pattern="*_iteration_*.$ext"
fi

# Find matching files, sorted by modification time (newest first)
matching_files=()
for f in "$LOG_DIR"/$pattern; do
  [ -f "$f" ] && matching_files+=("$f")
done

# Also include pipeline.log and orchestrator.log if no agent filter
if [ -z "$AGENT_FILTER" ] && [ "$RAW_MODE" = false ]; then
  for extra in pipeline.log orchestrator.log; do
    [ -f "$LOG_DIR/$extra" ] && matching_files+=("$LOG_DIR/$extra")
  done
fi

if [ ${#matching_files[@]} -eq 0 ]; then
  echo "No log files found matching pattern: $LOG_DIR/$pattern"
  echo ""
  echo "Waiting for logs to appear..."
  echo "(Start the pipeline with --verbose-logs for detailed output)"
  echo ""

  # Wait for files to appear, then start tailing
  while true; do
    for f in "$LOG_DIR"/$pattern; do
      if [ -f "$f" ]; then
        matching_files+=("$f")
      fi
    done
    if [ ${#matching_files[@]} -gt 0 ]; then
      break
    fi
    sleep 2
  done
fi

echo "Monitoring ${#matching_files[@]} log file(s):"
for f in "${matching_files[@]}"; do
  echo "  $(basename "$f")"
done
echo ""
echo "Press Ctrl+C to stop monitoring."
echo ""

# Use tail -f to follow all matching files
# The -F flag handles file rotation (new iterations creating new files)
exec tail -F "${matching_files[@]}" 2>/dev/null
