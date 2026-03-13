# Project Structure

Complete reference for the repository layout and how each component connects.

## Directory Map

```mermaid
flowchart TD
    Root["coding-agents/"]

    Root --> Pipeline["pipeline/\nOrchestrator & Ralph Loop scripts"]
    Root --> Agents["agents/\nAgent prompt definitions"]
    Root --> Manifests["manifests/\nExecution plans (orders + PRDs + repos)"]
    Root --> PRDs["prds/\nProduct Requirements Documents"]
    Root --> Contexts["contexts/\nPer-repo context files"]
    Root --> Templates["templates/\nManifest, PRD & context templates"]
    Root --> Skills["skills/\nCursor-compatible skills"]
    Root --> DevC[".devcontainer/\nDev Container configs"]
    Root --> Docs["docs/\nProject documentation"]
    Root --> Config["config/\nSettings templates"]

    Pipeline --> POrch["orchestrator.sh\n(manifest orchestrator)"]
    Pipeline --> PPipe["run-pipeline.sh\n(single PRD × repo + container)"]
    Pipeline --> PRun["run-agent.sh\n(Ralph Loop)"]
    Pipeline --> PLib["lib/\nprogress.sh\ngit-utils.sh\nvalidation.sh\nprd-parser.sh"]

    Agents --> ABase["_base-system.md"]
    Agents --> AArch["architect/prompt.md"]
    Agents --> ADes["designer/prompt.md"]
    Agents --> ADev["developer/prompt.md"]
    Agents --> ATest["tester/prompt.md"]
    Agents --> ASec["secops/prompt.md"]
    Agents --> AInfra["infrastructure/prompt.md"]
    Agents --> AOps["devops/prompt.md"]
    Agents --> ARev["reviewer/prompt.md"]

    DevC --> DCMain["devcontainer.json\n(for editing this repo)"]
    DevC --> DCAgent["agent/\n(for running agents headlessly)"]

    Templates --> TManifest["manifest.json"]
    Templates --> TPRD["prd.md"]
    Templates --> TCtx["project-context.md"]
```

## Component Relationships

```mermaid
flowchart LR
    subgraph User["User Input"]
        Manifest["Manifest JSON\n(orders, PRDs, repos, contexts)"]
        Env[".env config"]
    end

    subgraph Orchestration["Pipeline Layer"]
        Orch["orchestrator.sh\n(manifest orchestrator)"]
        Pipe["run-pipeline.sh\n(container lifecycle)"]
        Runner["run-agent.sh"]
        Libs["lib/ utilities"]
    end

    subgraph AgentLayer["Agent Layer"]
        Base["_base-system.md"]
        Prompts["Agent prompts\n(8 agents)"]
    end

    subgraph Infra["Infrastructure"]
        DC[".devcontainer/agent/\n(headless container)"]
        MCP[".mcp.json"]
        Claude["Claude Code CLI"]
    end

    subgraph Output["Pipeline Output"]
        Branch["Feature branch\n(from PRD Working Branch)"]
        Artifacts["Architecture docs\nDesign specs\nTest reports"]
        PullReq["Pull Request"]
        Evidence["Evidence comments\n(agent reports on PR)"]
        CtxUpdate["Updated context\n(synced to contexts/)"]
    end

    Manifest --> Orch
    Env --> Orch
    Orch -->|"per PRD×repo"| Pipe
    Pipe -->|"starts"| DC
    Pipe -->|"devcontainer exec"| Runner
    Runner --> Libs
    Runner -->|builds prompt from| Base
    Runner -->|builds prompt from| Prompts
    Runner -->|invokes| Claude
    Claude -->|uses| MCP
    DC -->|sandbox for| Claude
    Claude --> Branch
    Claude --> Artifacts
    Pipe --> PullReq
    PullReq --> Evidence
    Pipe --> CtxUpdate
```

## File Reference

| File | Purpose | Modified When |
|------|---------|---------------|
| `pipeline/orchestrator.sh` | Manifest orchestrator: orders, parallel PRDs, per-repo context | Changing execution model, adding manifest features |
| `pipeline/run-pipeline.sh` | Single PRD × single repo: Dev Container lifecycle, agent sequence, PR, repo-root logging | Adding agents, changing container config, flow |
| `pipeline/run-agent.sh` | Ralph Loop implementation, prompt assembly | Changing iteration logic or prompt structure |
| `pipeline/lib/prd-parser.sh` | Parse PRD metadata: status, title, priority, working branch | Changing PRD metadata format |
| `pipeline/lib/progress.sh` | Read/write `.agent-progress/` files | Changing progress format |
| `pipeline/lib/git-utils.sh` | Clone, branch, PR creation, PR evidence posting | Changing git workflow |
| `pipeline/lib/validation.sh` | Environment, PRD, and devcontainer validation | Adding new validations |
| `agents/_base-system.md` | Shared instructions for all agents | Changing universal agent behavior |
| `agents/*/prompt.md` | Per-agent instructions and completion criteria | Modifying agent behavior |
| `manifests/*.json` | Execution plans: orders, PRDs, repos, contexts | Adding projects or changing execution plans |
| `contexts/*.md` | Per-repo context files (injected as ephemeral CLAUDE.md) | Repo conventions change, new repos added |
| `templates/manifest.json` | Manifest template | Changing manifest schema |
| `templates/prd.md` | PRD template for users | Changing required PRD sections |
| `templates/project-context.md` | Project context template | Changing project setup workflow |
| `.devcontainer/devcontainer.json` | Dev Container for editing this repo (VS Code/Cursor) | Changing IDE dev environment |
| `.devcontainer/agent/*` | Dev Container for running agents headlessly | Changing agent sandbox |
| `.mcp.json` | MCP server connections (GitHub, Notion, Figma) | Adding/removing integrations |
| `.env.example` | Environment variable documentation | Adding new config options |
| `config/settings.json` | Claude Code settings template | Changing default model or permissions |
| `skills/*/SKILL.md` | Cursor agent skills | Adding skills or changing workflows |
| `.cursor/rules/*.mdc` | Cursor rules for maintaining this repo | Changing development conventions |
| `CLAUDE.md` | Claude Code instructions for this repo | Changing project structure or conventions |
| `docs/*.md` | This documentation | Any significant change to the repo |
