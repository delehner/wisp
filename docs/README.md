# Wisp documentation

This folder contains guides for installing, configuring, and extending Wisp. Start with [Prerequisites](prerequisites.md) and [Configuration](configuration.md) if you are setting up for the first time.

## Getting started

| Document | What it covers |
|----------|----------------|
| [Prerequisites](prerequisites.md) | Required tools (`git`, Docker, `devcontainer`, `gh`, Claude or Gemini), authentication |
| [Configuration](configuration.md) | `.env`, `WISP_ROOT_DIR`, Homebrew/curl installs vs working from a git clone |
| [Pipeline overview](pipeline-overview.md) | End-to-end flow, agent responsibilities, manifest behavior, CLI-oriented reference |

## Using Wisp from the CLI

| Document | What it covers |
|----------|----------------|
| [Ralph loop](ralph-loop.md) | Iteration mechanism, prompt assembly, completion detection (`.agent-progress/`) |
| [Project structure](project-structure.md) | Repository layout, how Rust modules and `agents/` relate |

## VS Code extension

| Document | What it covers |
|----------|----------------|
| [Installing the extension](vscode-install.md) | Marketplace, VSIX from releases, build from source |
| [Extension feature guide](vscode-extension.md) | Commands, sidebar explorer, settings, troubleshooting |
| [Publishing the extension](vscode-publish.md) | Maintainer workflow: PAT, releases, rotation |

## Extending Wisp

| Document | What it covers |
|----------|----------------|
| [Adding agents](adding-agents.md) | Steps to add a new pipeline agent (Rust + prompts + schema) |
| [MCP integrations](mcp-integrations.md) | Optional MCP servers (Notion, Figma, Slack, Jira) for Claude Code |

## Architecture notes (`architecture/`)

The [`architecture/`](architecture/) directory holds design write-ups, PR descriptions, and agent outputs from past work (for example VS Code extension milestones). It is useful for maintainers and contributors tracing decisions; day-to-day usage is covered in the guides above.

---

[← Back to repository README](../README.md)
