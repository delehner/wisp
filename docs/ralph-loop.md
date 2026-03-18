# Ralph Loop Mechanism

A Ralph Loop wraps an AI agent (Claude Code or Gemini CLI) in an iterative execution cycle. Each iteration gets a fresh context window, with progress persisted to the filesystem between iterations. This overcomes context window limits and allows self-correction. The pipeline's provider abstraction (`pipeline/lib/provider.sh`) handles CLI-specific flags, auth, and output formats for each provider.

## How It Works

```mermaid
flowchart TD
    Start([run-agent.sh called]) --> Init[Initialize\nprogress directory]
    Init --> LoopStart

    subgraph Loop["Ralph Loop (max N iterations)"]
        LoopStart{Already\ncompleted?} -->|Yes| Done
        LoopStart -->|No| Build[Build prompt:\nbase system +\nagent prompt +\nPRD +\nprevious agents +\nown progress +\niteration context]
        Build --> TempFile[Write prompt\nto temp file]
        TempFile --> AI["AI CLI (claude/gemini)\nprovider.sh invokes with\nmodel + provider-specific flags"]
        AI --> CheckStatus{Progress file\nstatus = COMPLETED?}
        CheckStatus -->|Yes| Done
        CheckStatus -->|No| MaxCheck{Max iterations\nreached?}
        MaxCheck -->|No| Sleep[Sleep 2s\nrate limit] --> LoopStart
        MaxCheck -->|Yes| Warn[Log warning:\nmax iterations reached]
    end

    Done([Agent finished])
    Warn --> Done
```

## Why Ralph Loops Work

### Fresh Context Per Iteration
Each iteration invokes the AI CLI (e.g. `claude -p` or `gemini -p`) via `provider.sh`, starting a new session with a full context window. No stale context accumulates.

### Filesystem as Memory
Progress, decisions, and artifacts are written to `.agent-progress/<agent>.md` and `docs/architecture/`. Each iteration reads this file to understand what's already been done.

At pipeline start for a new PRD, previous `.agent-progress/*.md` files are cleared to ensure each PRD executes a fresh Architect → Reviewer sequence.

### Self-Correction
If an iteration produces incorrect code or misses a task, the next iteration sees the current state (including failing tests or incomplete tasks) and can correct course.

## Prompt Assembly Per Iteration

The prompt is assembled from multiple sources, layered in this order:

```mermaid
flowchart TD
    subgraph Prompt["Assembled Prompt"]
        direction TB
        L1["1. Base System Instructions\n(agents/_base-system.md)"]
        L2["2. Agent-Specific Prompt\n(agents/architect/prompt.md)"]
        L3["3. PRD Content\n(the full PRD file)"]
        L4["4. Previous Agents' Progress\n(.agent-progress/architect.md, etc.)"]
        L5["5. Own Progress from Prior Iterations\n(.agent-progress/current-agent.md)"]
        L6["6. Architecture Doc\n(if exists, for non-architect agents)"]
        L7["7. Design Doc\n(if exists, for developer/tester/reviewer)"]
        L8["8. Project context file\n(CLAUDE.md or GEMINI.md,\nif exists in target repo)"]
        L9["9. Iteration Context\n(iteration N of M, working directory)"]

        L1 --- L2 --- L3 --- L4 --- L5 --- L6 --- L7 --- L8 --- L9
    end
```

## Completion Detection

An agent is considered `COMPLETED` when its progress file contains:

```markdown
## Status: COMPLETED
```

The `is_agent_completed()` function in `pipeline/lib/progress.sh` parses this status. If the status is `COMPLETED` at the start of an iteration, the loop exits immediately.

## Iteration Limits

Iteration limits can be configured at three levels (highest priority wins):

```mermaid
flowchart LR
    A["Agent-specific env var\n(e.g., DEVELOPER_MAX_ITERATIONS=15)"]
    B["Pipeline default env var\n(PIPELINE_MAX_ITERATIONS=10)"]
    C["CLI flag\n(--max-iterations 20)"]
    D["Hardcoded default\n(10)"]

    A -->|overrides| B -->|overrides| C -->|overrides| D
```

## Session Resume

To resume an agent session interactively (e.g. after a pipeline pause or for debugging):

```bash
# Claude Code
claude --resume <session-id>

# Gemini CLI
gemini --resume <session-id>
```

Session IDs are shown in pipeline output and can be listed with `ca monitor --sessions`.

## Cost Implications

Each iteration consumes API tokens. A typical iteration uses 10K-50K input tokens (prompt) and 2K-10K output tokens (response). With Claude Opus 4.6:

| Scenario | Iterations | Est. Input Tokens | Est. Cost |
|----------|-----------|-------------------|-----------|
| Simple agent (architect) | 2-3 | 30K-60K per iteration | $2-5 |
| Complex agent (developer) | 5-15 | 50K-100K per iteration | $10-30 |
| Max iterations hit | 10 | 50K per iteration | $15-25 |

Set `MAX_ITERATIONS` conservatively and monitor logs to calibrate.
