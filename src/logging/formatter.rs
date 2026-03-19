use std::io::{BufRead, Write};

use crate::cli::ProviderKind;

/// Format JSONL events from an AI CLI into human-readable output.
pub fn format_jsonl_stream(
    reader: impl BufRead,
    writer: &mut impl Write,
    provider: ProviderKind,
    truncate_len: usize,
) {
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };

        if line.trim().is_empty() {
            continue;
        }

        let parsed: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                // Not JSON, pass through as-is
                let _ = writeln!(writer, "{line}");
                continue;
            }
        };

        match provider {
            ProviderKind::Claude => format_claude_event(&parsed, writer, truncate_len),
            ProviderKind::Gemini => format_gemini_event(&parsed, writer, truncate_len),
        }
    }
}

/// Auto-detect provider from JSONL content heuristics.
pub fn detect_provider(line: &str) -> Option<ProviderKind> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
        // Claude markers
        if v.get("message").and_then(|m| m.get("content")).is_some() {
            return Some(ProviderKind::Claude);
        }
        if let Some(t) = v.get("type").and_then(|t| t.as_str()) {
            if matches!(t, "init" | "system" | "stream_event") {
                return Some(ProviderKind::Claude);
            }
        }
        if v.get("cost_usd").is_some() {
            return Some(ProviderKind::Claude);
        }

        // Gemini markers
        if v.get("thought").is_some() || v.get("functionCall").is_some() {
            return Some(ProviderKind::Gemini);
        }
        if v.get("stats").and_then(|s| s.get("models")).is_some() {
            return Some(ProviderKind::Gemini);
        }
    }
    None
}

fn format_claude_event(event: &serde_json::Value, w: &mut impl Write, truncate: usize) {
    let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match event_type {
        "init" | "system" => {
            if let Some(id) = event.get("session_id").and_then(|v| v.as_str()) {
                let _ = writeln!(w, "\x1b[2m[session: {id}]\x1b[0m");
            }
        }
        "assistant" => {
            if let Some(content) = event
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for block in content {
                    format_claude_content_block(block, w, truncate);
                }
            }
        }
        "result" => {
            let cost = event
                .get("cost_usd")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let duration = event
                .get("duration_ms")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let turns = event.get("num_turns").and_then(|v| v.as_u64()).unwrap_or(0);
            let _ = writeln!(
                w,
                "\x1b[2m[result: ${cost:.4}, {duration}ms, {turns} turns]\x1b[0m"
            );
            if let Some(id) = event.get("session_id").and_then(|v| v.as_str()) {
                let _ = writeln!(w, "\x1b[2m[session: {id}]\x1b[0m");
            }
        }
        _ => {
            // stream_event or unknown — extract text/thinking deltas
            if let Some(delta) = event
                .get("content_block_delta")
                .or_else(|| event.get("delta"))
            {
                if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                    let _ = write!(w, "{text}");
                } else if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                    let _ = write!(w, "\x1b[2m{thinking}\x1b[0m");
                }
            }
        }
    }
}

fn format_claude_content_block(block: &serde_json::Value, w: &mut impl Write, truncate: usize) {
    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match block_type {
        "thinking" => {
            if let Some(text) = block.get("thinking").and_then(|v| v.as_str()) {
                let _ = writeln!(w, "\x1b[2m[thinking]\x1b[0m");
                let _ = writeln!(w, "\x1b[2m{text}\x1b[0m");
            }
        }
        "text" => {
            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                let _ = writeln!(w, "{text}");
            }
        }
        "tool_use" => {
            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let input = block
                .get("input")
                .map(|v| v.to_string())
                .unwrap_or_default();
            let display = truncate_str(&input, truncate);
            let _ = writeln!(w, "\x1b[36m[tool: {name}]\x1b[0m {display}");
        }
        "tool_result" => {
            let content = block
                .get("content")
                .map(|v| v.to_string())
                .unwrap_or_default();
            let display = truncate_str(&content, truncate);
            let _ = writeln!(w, "\x1b[2m[result]\x1b[0m {display}");
        }
        _ => {}
    }
}

fn format_gemini_event(event: &serde_json::Value, w: &mut impl Write, truncate: usize) {
    if let Some(thought) = event.get("thought").and_then(|v| v.as_str()) {
        let _ = writeln!(w, "\x1b[2m[thinking]\x1b[0m");
        let _ = writeln!(w, "\x1b[2m{thought}\x1b[0m");
        return;
    }

    if let Some(text) = event.get("text").and_then(|v| v.as_str()) {
        let _ = writeln!(w, "{text}");
        return;
    }

    // Tool calls
    if let Some(fc) = event.get("functionCall").or_else(|| event.get("tool_call")) {
        let name = fc.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        let args = fc
            .get("args")
            .or_else(|| fc.get("input"))
            .map(|v| v.to_string())
            .unwrap_or_default();
        let display = truncate_str(&args, truncate);
        let _ = writeln!(w, "\x1b[36m[tool: {name}]\x1b[0m {display}");
        return;
    }

    // Tool results
    if event.get("functionResponse").is_some() || event.get("tool_result").is_some() {
        let result = event
            .get("functionResponse")
            .or_else(|| event.get("tool_result"))
            .map(|v| v.to_string())
            .unwrap_or_default();
        let display = truncate_str(&result, truncate);
        let _ = writeln!(w, "\x1b[2m[result]\x1b[0m {display}");
        return;
    }

    // Stats / completion
    if let Some(stats) = event.get("stats") {
        let tokens = stats
            .get("totalTokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let latency = stats.get("latencyMs").and_then(|v| v.as_u64()).unwrap_or(0);
        let _ = writeln!(w, "\x1b[2m[done: {tokens} tokens, {latency}ms]\x1b[0m");

        if let Some(id) = event
            .get("sessionId")
            .or_else(|| event.get("session_id"))
            .and_then(|v| v.as_str())
        {
            let _ = writeln!(w, "\x1b[2m[session: {id}]\x1b[0m");
        }
    }
}

fn truncate_str(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}... ({} chars total)", &s[..max_len], s.len())
    }
}
