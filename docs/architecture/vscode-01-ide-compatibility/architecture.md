# Architecture: IDE Workspace Compatibility — VSCode, Cursor & Antigravity

## Overview

Add workspace-level configuration files to the Wisp repository so that developers using VSCode, Cursor, or Antigravity get a fully configured Rust development environment — recommended extensions, debug launch configs, task definitions, editor settings, Rust Analyzer configuration, Cursor AI rules, and Antigravity context — all pre-configured and ready to use with zero manual setup.

This is a **pure configuration change**: no Rust source files are modified and no new dependencies are added. All deliverables are static files checked into the repository.

---

## System Design

### Components

| File/Directory | IDE | Purpose |
|---|---|---|
| `.vscode/settings.json` | VSCode, Cursor, Antigravity | Rust Analyzer, editor, formatting, file hiding |
| `.vscode/extensions.json` | VSCode, Cursor, Antigravity | Recommended extension list |
| `.vscode/tasks.json` | VSCode, Cursor, Antigravity | Common cargo tasks with problem matchers |
| `.vscode/launch.json` | VSCode, Cursor, Antigravity | Debug launch configs for the wisp binary |
| `.cursor/rules/architecture.mdc` | Cursor | Module responsibilities, data flow, key abstractions |
| `.antigravity/context.md` | Antigravity | Project overview and architecture summary |
| `.antigravity/conventions.md` | Antigravity | Rust style and async patterns |
| `wisp.code-workspace` | All three | Multi-root workspace file (entry point for workspace open) |

### Data Flow

No runtime data flow — all files are static configuration read by the IDE at workspace open time. The `.vscode/` settings files affect how the IDE processes the repository; the Cursor `.mdc` files influence AI suggestions; the `.antigravity/` files provide context to Antigravity's AI assistant.

### Relationship to Existing Files

- **CLAUDE.md**: The authoritative source of truth for project conventions. Cursor rules and Antigravity context files summarize and reference it rather than duplicating it.
- **Existing `.cursor/rules/`**: Six files already exist:
  - `project-overview.mdc` — high-level structure and pipeline flow
  - `rust-conventions.mdc` — cargo commands, module patterns, external commands
  - `agent-prompts.mdc` — agent prompt file conventions and how to add agents
  - `keep-docs-updated.mdc` — documentation update triggers
  - `skills-format.mdc` — IDE skill YAML frontmatter conventions
  - `templates.mdc` — (contents not shown, assumed template conventions)
  - **Gap**: No rule covering module-level boundaries, the Provider trait, or the Ralph Loop data flow. → Add `architecture.mdc`.

---

## File Structure

```
wisp/
├── .vscode/
│   ├── settings.json        # Rust Analyzer, editor, file exclusions, terminal env
│   ├── extensions.json      # Recommended extensions list
│   ├── tasks.json           # cargo build/test/clippy/fmt + wisp run task
│   └── launch.json          # Debug: wisp orchestrate, wisp run (uses CodeLLDB)
├── .cursor/
│   └── rules/
│       └── architecture.mdc # NEW: module responsibilities, Provider trait, Ralph Loop
├── .antigravity/
│   ├── context.md           # Project overview, file map, pipeline flow
│   └── conventions.md       # Rust style, error handling, async patterns
└── wisp.code-workspace      # Multi-root workspace (all three IDEs open this)
```

---

## Technical Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|---|---|---|---|
| Reuse `.vscode/` for all three IDEs | Yes — single `.vscode/` dir | VSCode, Cursor, and Antigravity all recognize the `.vscode/` format natively. No need to duplicate settings. | Separate per-IDE dirs — unnecessary complexity |
| Cursor rules approach | Add only `architecture.mdc`; do not modify existing rules | Existing rules cover rust conventions and agent prompts; only module-level architecture is missing. Avoids duplication and merge conflicts. | Replace all rules with new ones — loses existing content |
| Antigravity context format | Generic markdown (no IDE-specific frontmatter) | Antigravity's workspace context spec is not publicly documented. Generic markdown works universally and is forward-compatible. | Proprietary format — risk of breakage on spec change |
| Debugger extension | `vadimcn.vscode-lldb` (CodeLLDB) | PRD specifies this; CodeLLDB is the community standard for native Rust debugging in VS Code family IDEs. | `ms-vscode.cpptools` — does not support Rust DWARF debug info as well |
| `rust-analyzer.check.command` | `clippy` | Mirrors CI enforcement (clippy with -D warnings). Inline diagnostics match what CI rejects. | `check` — misses clippy lints, leading to CI surprises |
| `editor.formatOnSave` | `true` with rust-analyzer as Rust formatter | Enforces `cargo fmt` convention from CLAUDE.md automatically. | Manual formatting — inconsistent |
| `RUST_LOG` in terminal env | `info` | Default log level from CLAUDE.md; makes `wisp` commands readable in the integrated terminal by default. | Not set — agents would produce no log output |
| `wisp.code-workspace` workspace-level settings | Mirror `.vscode/settings.json` key subset | Workspace file settings override folder settings in some IDEs; keeping them in sync ensures consistent behavior regardless of how the workspace is opened. | Only use folder-level settings — may not apply when opened via .code-workspace |

---

## File Specifications

### `.vscode/settings.json`

```jsonc
{
  // Rust Analyzer
  "rust-analyzer.check.command": "clippy",
  "rust-analyzer.check.extraArgs": ["-D", "warnings"],
  "rust-analyzer.cargo.features": "all",
  "rust-analyzer.procMacro.enable": true,

  // Editor
  "editor.formatOnSave": true,
  "[rust]": {
    "editor.defaultFormatter": "rust-lang.rust-analyzer"
  },
  "editor.rulers": [100],

  // File exclusions (reduce noise)
  "files.exclude": {
    "target/": true,
    ".agent-progress/": true,
    ".pipeline/": true,
    "**/*.jsonl": true
  },

  // Terminal
  "terminal.integrated.env.osx": { "RUST_LOG": "info" },
  "terminal.integrated.env.linux": { "RUST_LOG": "info" },
  "terminal.integrated.env.windows": { "RUST_LOG": "info" }
}
```

### `.vscode/extensions.json`

```json
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "tamasfe.even-better-toml",
    "vadimcn.vscode-lldb",
    "fill-labs.dependi",
    "serayuzgur.crates",
    "GitHub.vscode-pull-request-github"
  ]
}
```

### `.vscode/tasks.json`

Tasks with `problemMatcher: "$rustc"` for build tasks:

| Task Label | Command | Problem Matcher |
|---|---|---|
| `cargo build` | `cargo build` | `$rustc` |
| `cargo build (release)` | `cargo build --release` | `$rustc` |
| `cargo test` | `cargo test` | `$rustc` |
| `cargo clippy` | `cargo clippy -- -D warnings` | `$rustc` |
| `cargo fmt` | `cargo fmt` | none |
| `wisp run (example)` | `wisp run --agent developer --workdir /tmp/wisp-test` | none |

All tasks use `type: "shell"`, `group: "build"` (except test/wisp), `presentation.reveal: "always"`.

### `.vscode/launch.json`

Two configurations using `vadimcn.vscode-lldb`:

1. **`wisp orchestrate`** — Debug orchestration via manifest:
   - `program`: `${workspaceFolder}/target/debug/wisp`
   - `args`: `["orchestrate", "--manifest", "${workspaceFolder}/manifests/sample.json"]`
   - `preLaunchTask`: `cargo build`
   - `sourceLanguages`: `["rust"]`

2. **`wisp run (configurable)`** — Debug single agent run:
   - `program`: `${workspaceFolder}/target/debug/wisp`
   - `args`: `["run", "--agent", "${input:agentName}", "--workdir", "${input:workdir}", "--prd", "${input:prdPath}"]`
   - `preLaunchTask`: `cargo build`
   - `sourceLanguages`: `["rust"]`
   - `inputs` array for `agentName`, `workdir`, `prdPath` (type: `promptString`)

### `.cursor/rules/architecture.mdc`

```
---
description: Module boundaries, Provider trait, Ralph Loop, and data flow for the Wisp pipeline
globs: src/**/*.rs
alwaysApply: false
---
```

Content covers:
- Module ownership table (which file owns which responsibility)
- Provider trait contract (cli_name, build_run_args, extract_session_id, resume_hint)
- Ralph Loop mechanics (prompt assembly order, completion detection, session resumption)
- Pipeline data flow (manifest → orchestrator → runner → agent → git → PR)
- Key invariants (no raw std::process::Command, no println!, RAII DevContainer)

Does NOT duplicate: rust conventions (in rust-conventions.mdc), agent prompt format (in agent-prompts.mdc), project structure overview (in project-overview.mdc).

### `.antigravity/context.md`

Generic markdown file with:
- Project overview (what Wisp does, binary name, language)
- Key file map (src modules and their purpose)
- Pipeline flow (14-agent sequence with brief role descriptions)
- Key abstractions (Provider trait, Ralph Loop, Wave Stacking, Filesystem Memory)

### `.antigravity/conventions.md`

Generic markdown file with:
- Rust style conventions (cargo fmt, clippy, Rust 2021)
- Error handling patterns (anyhow + context, thiserror, bail!)
- Async patterns (tokio, JoinSet, Semaphore, CancellationToken)
- Logging (tracing macros, RUST_LOG)
- Naming conventions
- Command execution (exec_streaming, exec_capture)

### `wisp.code-workspace`

```jsonc
{
  "folders": [
    { "path": "." }
  ],
  "settings": {
    "rust-analyzer.check.command": "clippy",
    "rust-analyzer.check.extraArgs": ["-D", "warnings"],
    "editor.formatOnSave": true,
    "[rust]": {
      "editor.defaultFormatter": "rust-lang.rust-analyzer"
    }
  },
  "extensions": {
    "recommendations": [
      "rust-lang.rust-analyzer",
      "tamasfe.even-better-toml",
      "vadimcn.vscode-lldb",
      "fill-labs.dependi",
      "serayuzgur.crates",
      "GitHub.vscode-pull-request-github"
    ]
  }
}
```

---

## Dependencies

No new Rust dependencies. No changes to `Cargo.toml`.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Antigravity workspace context spec not publicly documented | Medium | Use generic markdown; content remains useful regardless of IDE-specific parsing |
| `.cursor/rules/architecture.mdc` duplicating existing rules | Low | Explicitly scope to module boundaries and data flow; existing rules scoped to Rust conventions and agent prompts |
| `launch.json` `preLaunchTask` naming must exactly match task label | Medium | Use exact label strings from `tasks.json`; document this constraint |
| `files.exclude` hiding files developers need | Low | Only exclude `target/`, `.agent-progress/`, `.pipeline/`, `*.jsonl` — all are pipeline/build artifacts, not source files |
| `rust-analyzer.check.extraArgs: ["-D", "warnings"]` causing noisy inline errors | Low | Matches CI behavior; developers should see the same errors CI catches |
| JSON syntax errors in config files | Medium | Developer agent must validate all JSON with a JSON parser before completing |

---

## Implementation Tasks

Ordered tasks for the Developer agent:

1. **Create `.vscode/settings.json`**
   - Write JSON per specification above
   - Acceptance: Valid JSON, `rust-analyzer.check.command` = `"clippy"`, `editor.formatOnSave` = `true`, `files.exclude` contains all four entries, `terminal.integrated.env.*` contains `RUST_LOG`

2. **Create `.vscode/extensions.json`**
   - Write JSON per specification above
   - Acceptance: Valid JSON, all six extension IDs present in `recommendations` array

3. **Create `.vscode/tasks.json`**
   - Write JSON with all six tasks per specification above
   - Acceptance: Valid JSON, all six task labels present, build/test/clippy tasks have `problemMatcher: "$rustc"`, each task has `type: "shell"`

4. **Create `.vscode/launch.json`**
   - Write JSON with two configurations per specification above
   - Acceptance: Valid JSON, both configurations present, both use `"type": "lldb"`, both have `preLaunchTask`, `sourceLanguages` includes `"rust"`, wisp-run config has `inputs` array

5. **Create `.cursor/rules/architecture.mdc`**
   - Write `.mdc` with YAML frontmatter + content per specification above
   - Acceptance: Valid YAML frontmatter, `globs: src/**/*.rs`, `alwaysApply: false`, content covers Provider trait and Ralph Loop without duplicating existing rules

6. **Create `.antigravity/context.md`**
   - Write generic markdown per specification above
   - Acceptance: Contains project overview, file map, pipeline flow, key abstractions

7. **Create `.antigravity/conventions.md`**
   - Write generic markdown per specification above
   - Acceptance: Contains Rust style, error handling, async patterns, logging, naming, command execution

8. **Create `wisp.code-workspace`**
   - Write JSONC per specification above
   - Acceptance: Valid JSON, `folders` contains repo root, `settings` includes Rust Analyzer and format-on-save, `extensions.recommendations` mirrors `.vscode/extensions.json`

9. **Validate all JSON files**
   - Run `python3 -m json.tool <file>` or `jq . <file>` on each `.json` file
   - Acceptance: Zero parse errors on all files

10. **Commit all files**
    - `git add .vscode/ .cursor/rules/architecture.mdc .antigravity/ wisp.code-workspace`
    - Commit with `feat(ide): add VSCode, Cursor, and Antigravity workspace configuration`
    - Acceptance: Clean commit, no runtime files staged (`.agent-progress/`, `logs/`, `CLAUDE.md`)

---

## Security Considerations

- No secrets or credentials in any config file
- `.vscode/settings.json` and `launch.json` do not execute arbitrary code
- `tasks.json` commands are limited to `cargo` and `wisp` — no shell expansion risks
- All files are static JSON/Markdown — no injection surface

---

## Performance Considerations

- IDE config files are read once at workspace open; no runtime performance impact
- `rust-analyzer.cargo.features: "all"` may increase analysis time on large feature sets; Wisp has no optional features so this is a no-op cost
- `rust-analyzer.procMacro.enable: true` improves accuracy of analysis for `#[derive]` macros (tokio::main, clap derive, serde derive) — net positive

---

## Completion Criteria for Architect

- [x] Architecture document written and comprehensive
- [x] File structure plan defined for all 9 output files
- [x] All technical decisions documented with rationale
- [x] Implementation tasks are ordered with clear acceptance criteria
- [x] Risks identified with mitigations
- [x] No new Rust dependencies required
