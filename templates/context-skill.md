# Context Skill Template

> A **context skill** is a focused markdown file that teaches AI agents about one aspect of a repository.
> Multiple context skills are stored in `contexts/<repo-name>/` and assembled into a single `CLAUDE.md` at pipeline runtime.
>
> **Compatible with**: Claude Code (assembled as CLAUDE.md) and Cursor (as `.cursor/rules/*.md`)

## Recommended Skills

Create one file per topic. Only include skills that are relevant to the repo — skip sections that don't apply.

| File | Purpose | When to include |
|------|---------|-----------------|
| `overview.md` | Project overview, purpose, tech stack | Always |
| `architecture.md` | Directory structure, key patterns, data flow | Always |
| `conventions.md` | Coding style, naming, imports, formatting | Always |
| `testing.md` | Test framework, patterns, coverage requirements | When project has tests |
| `api.md` | API conventions, endpoints, error formats | When project has APIs |
| `database.md` | ORM, schema, migrations, naming | When project uses a database |
| `components.md` | Component library, styling, state management | When project has a frontend |
| `build-deploy.md` | Build commands, CI/CD, deployment process | Always |
| `environment.md` | Environment variables, secrets | When project uses env vars |
| `integrations.md` | External services, SDKs, webhooks | When project has integrations |

## Skill File Format

Each skill file is plain markdown with optional YAML frontmatter:

```markdown
---
name: architecture
description: >-
  Project architecture, directory structure, and key patterns.
---

# Architecture

## Directory Structure

```
src/
├── app/           # Next.js app router pages
├── components/    # React components
├── lib/           # Utilities and helpers
└── services/      # Business logic
```

## Key Patterns

- Server Components by default, Client Components only when interactivity is needed
- Repository pattern for data access
- Zod schemas for all input validation
```

### Frontmatter Fields

- `name` (optional): Skill identifier. Defaults to filename without extension.
- `description` (optional): When the skill is relevant. Used by Cursor for auto-activation.

### Content Guidelines

- Keep each skill under 150 lines — shorter context is followed more reliably
- Be specific: `"Use vitest with @testing-library/react"` not `"Use a test framework"`
- Include concrete examples, not abstract descriptions
- Focus on project-specific knowledge the agent wouldn't infer from code alone
- Don't duplicate information between skills — reference other skills when needed

## Assembly Order

When the pipeline concatenates skills into `CLAUDE.md`, files are assembled in this order:

1. `overview.md` (always first — sets the context)
2. `architecture.md`
3. `conventions.md`
4. `components.md`
5. `api.md`
6. `database.md`
7. `testing.md`
8. `build-deploy.md`
9. `environment.md`
10. `integrations.md`
11. Any additional custom skills (alphabetical)

## Using with Cursor

Context skills are also compatible with Cursor rules. Copy them to the target repo:

```bash
cp contexts/my-repo/*.md /path/to/my-repo/.cursor/rules/
```

Or configure as always-applied rules in `.cursor/rules/` with `.mdc` extension.
