## Summary

- Adds `wisp install agents` subcommand under `InstallCmd` that downloads the canonical `agents/` directory from the wisp GitHub repository into `~/.wisp/agents/` (or a user-specified `--output` path).
- Supports `--force` to overwrite existing files; idempotent by default (existing files are skipped).
- Respects `GITHUB_TOKEN` for authenticated requests to avoid rate-limiting.
- Updates installation docs to explain the new quickstart path for Homebrew / curl installs.

## Changes

- **`src/cli.rs`**: Added `Agents(InstallAgentsArgs)` variant to `InstallCmd`; defined `InstallAgentsArgs` with `--output` and `--force` flags.
- **`src/install/mod.rs`**: New module re-exporting `agents`.
- **`src/install/agents.rs`**: Core implementation — `run()` async entry point, `fetch_tarball()` with `reqwest`, `extract_agents()` with `flate2`/`tar`. Includes path-traversal guard (`is_safe_path`), 50 MB response size cap, and skip/overwrite logic. Full unit test suite (in-memory tarball helpers, path safety, skip/force behavior).
- **`src/main.rs`**: Added `mod install;` and dispatch arm for `InstallCmd::Agents`.
- **`Cargo.toml`**: Added `reqwest` (rustls-tls, stream), `flate2`, `tar` dependencies.
- **`docs/configuration.md`**: Added "Option B: Use `wisp install agents`" quickstart section and updated install-method table.
- **`docs/prerequisites.md`**: Updated note to mention `wisp install agents` for Homebrew/curl installs.

## Architecture Decisions

- **Tarball download over GitHub API tree endpoint**: Simpler, no pagination, no per-file requests. GitHub redirects the tarball URL — `reqwest` follows redirects automatically.
- **`tokio::task::spawn_blocking` for extraction**: `flate2`/`tar` are sync; offloading to a blocking thread keeps the async executor responsive.
- **No streaming extraction**: The 50 MB cap and full in-memory buffer trade memory for simplicity. Agent files are small; the entire `agents/` tree is well under 1 MB in practice.
- **`rustls-tls` for `reqwest`**: Avoids OpenSSL link dependency; consistent with wisp's static binary goals.

## Testing

- Unit tests: 11 new tests covering `resolve_destination`, `is_safe_path`, prefix-stripping logic, and `extract_agents` (create, skip, force overwrite, filtering, multi-file).
- Integration (ignored, manual): `test_fetch_tarball_live` — verifies live download returns valid gzip bytes.
- `cargo test` passes.
- `cargo clippy -- -D warnings` passes.
- `cargo fmt --check` passes.

## Screenshots / Recordings

N/A — CLI-only change.

## Checklist

- [x] Tests pass
- [x] Build succeeds
- [x] No linter errors
- [x] Architecture doc reviewed
- [x] Design spec followed
- [x] Accessibility verified (N/A — CLI)
- [x] Security considerations addressed (path traversal guard, size cap, HTTPS with rustls)

## Review Notes

- The `is_safe_path` function rejects `CurDir` (`.`), `ParentDir` (`..`), absolute paths, and prefix/root components. Only `Component::Normal` segments are allowed, which is the safe minimal set for tar entries from GitHub.
- The 50 MB cap is checked against both the `Content-Length` header (fast fail before allocation) and the actual byte count after download (defense in depth).
- Entry-type filter uses `entry_type().is_file()` rather than `!entry_type().is_dir()` to also reject symlinks and hardlinks — avoids symlink-based traversal attacks in adversarial tarballs.
