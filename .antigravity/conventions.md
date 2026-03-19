# Wisp — Development Conventions

## Rust Style

- **Edition**: Rust 2021
- **Formatter**: `cargo fmt` — run before every commit
- **Linter**: `cargo clippy -- -D warnings` — zero warnings policy
- **Line length**: 100 characters (enforced by `editor.rulers`)

## Error Handling

Use `anyhow::Result` at application boundaries, `thiserror` for typed domain errors:

```rust
// anyhow with context at callsite
fn do_thing() -> anyhow::Result<()> {
    some_op().context("failed to do X")?;
    Ok(())
}

// thiserror for errors that need matching
#[derive(thiserror::Error, Debug)]
enum PipelineError {
    #[error("agent {0} failed: {1}")]
    AgentFailed(String, String),
}
```

Rules:
- Always add `.context("...")` or `.with_context(|| ...)` when propagating with `?`
- Prefer `anyhow::bail!()` over `return Err(anyhow!(...))`
- Never use `.unwrap()` or `.expect()` in production code paths

## Async Patterns

- Runtime: `tokio` with `#[tokio::main]` at top level
- All I/O is async; blocking calls use `tokio::task::spawn_blocking`
- Parallel tasks: `tokio::task::JoinSet`
- Concurrency limiting: `tokio::sync::Semaphore`
- Cancellation: `tokio_util::sync::CancellationToken`

## Command Execution

Always use helpers from `src/utils.rs`, never raw `std::process::Command`:

```rust
// Stream output with line callbacks
exec_streaming(&["cargo", "test"], dir, |line| { ... }, |line| { ... }).await?;

// Capture full stdout/stderr
let (stdout, stderr) = exec_capture(&["gh", "pr", "create", ...], dir).await?;
```

## Logging

Use `tracing` macros — never `println!`:

```rust
tracing::info!(agent = %name, iteration = i, "starting agent");
tracing::warn!("container not stopped explicitly");
tracing::error!(err = %e, "pipeline failed");
```

Log level is set via `RUST_LOG` environment variable (default: `info`).

## Naming Conventions

| Category | Convention | Example |
|---|---|---|
| Modules | snake_case | `pipeline/orchestrator.rs` |
| Structs/Enums/Traits | PascalCase | `AgentRunner`, `Provider` |
| Functions/Variables | snake_case | `build_run_args`, `max_iterations` |
| Constants | UPPER_SNAKE | `DEFAULT_AGENTS`, `NON_BLOCKING_AGENTS` |
| CLI flags | kebab-case | `--max-iterations`, `--skip-pr` |

## Code Organization

- Keep functions focused — prefer ~50 lines per function
- Put associated helpers close to the type they serve
- Avoid `pub` on internal implementation details
- Tests go in `#[cfg(test)]` modules at the bottom of the file

## Testing

```bash
cargo test              # run all tests
cargo test -- --nocapture  # show output during tests
cargo clippy            # linting
cargo fmt --check       # formatting check
```

Tests for pure functions live inline in the module. External dependencies (CLIs, git, Docker) are integration-tested via `wisp run` / `wisp pipeline`.

## Git Conventions

- Atomic commits with conventional commits format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `arch`, `design`
- Never force push; never rewrite history
- Do not commit `.agent-progress/`, `logs/`, `.pipeline/`, `CLAUDE.md`, or `GEMINI.md`
