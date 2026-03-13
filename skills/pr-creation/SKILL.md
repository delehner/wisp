---
name: pr-creation
description: >-
  Create well-structured pull requests with comprehensive descriptions, proper
  branch management, evidence comments, and review-ready summaries. Use when the
  user asks to create a PR, open a pull request, prepare changes for review, or
  push a feature branch.
---

# PR Creation

## When to Use

- User asks to "create a PR", "open a pull request", or "push this for review"
- After completing a feature or fix that's ready for review
- When preparing a branch for merge

## Process

1. **Verify readiness** — build passes, tests pass, no linter errors
2. **Review changes** — `git diff` to understand the full scope
3. **Check branch** — ensure you're on the correct working branch declared in the PRD
4. **Verify no runtime artifacts are staged** — `.agent-progress/`, `logs/`, `.pipeline/`, `CLAUDE.md` must never be committed
5. **Stage and commit** — atomic commits with conventional messages
6. **Push branch** — `git push -u origin HEAD`
7. **Create PR** — via `gh pr create` with structured description
8. **Post evidence** — attach agent reports (test results, security report) as PR comments

## Pre-PR Checklist

Run these before creating the PR:

```bash
# Build check
npm run build      # or project-specific build command

# Test check
npm test           # or project-specific test command

# Lint check
npm run lint       # or project-specific lint command

# Type check (TypeScript)
npx tsc --noEmit   # if applicable

# Verify no runtime artifacts are tracked
git status  # should NOT show .agent-progress/, logs/, .pipeline/, or CLAUDE.md
```

## Branch Naming

This project uses PRD-declared working branches. Each PRD has a `**Working Branch**` metadata field that defines the feature branch name.

| Convention | Pattern | Example |
|------------|---------|---------|
| **PRD branch (preferred)** | `username/prd-slug` | `delehner/01-foundation` |
| Feature branch (manual) | `feat/<description>` | `feat/user-auth-oauth` |
| Fix branch (manual) | `fix/<description>` | `fix/login-redirect-loop` |

The pipeline reads the working branch from the PRD. If not declared, it auto-generates from the PRD title.

## Files That Must Never Be Committed

These are runtime-only paths managed by the pipeline:

- `.agent-progress/` — progress tracking files
- `logs/` — pipeline log output
- `.pipeline/` — pipeline staging directory
- `CLAUDE.md` — ephemeral project context injected by the pipeline

Prefer explicit `git add src/...` over `git add .` to avoid accidents.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): concise description

Optional body explaining WHY, not WHAT.
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `arch`, `design`

## PR Description Template

The reviewer agent produces `docs/architecture/<prd-slug>/pr-description.md` which is used as the PR body. For manual PRs, use:

```markdown
## Summary
[1-3 bullet points describing the change and its purpose]

## Changes
- **[area]**: [what changed and why]
- **[area]**: [what changed and why]

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] Edge cases verified

## Screenshots
[If UI changes — before/after screenshots]

## Notes for Reviewers
[Any context that helps the reviewer understand decisions]
```

## Creating the PR

```bash
# Pipeline handles this automatically with 3 retries.
# For manual creation:
gh pr create \
  --base main \
  --title "feat(scope): description" \
  --body "$(cat <<'EOF'
## Summary
- description

## Changes
- **area**: change

## Testing
- [x] Tests pass

EOF
)"
```

## Evidence Comments

After PR creation, the pipeline posts agent reports as PR comments for traceability. Configurable via `EVIDENCE_AGENTS` env var (default: `tester,secops,infrastructure,devops`).

For manual evidence posting:

```bash
# Post a report as a PR comment
gh pr comment <pr-url> --body "$(cat docs/architecture/<prd-slug>/test-report.md)"
```

## After Creation

- Link related issues: `gh pr edit <number> --add-label "enhancement"`
- Request reviewers if needed: `gh pr edit <number> --add-reviewer @username`
- Monitor CI checks: `gh pr checks <number>`
