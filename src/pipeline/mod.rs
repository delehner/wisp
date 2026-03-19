pub mod agent;
pub mod devcontainer;
pub mod orchestrator;
pub mod runner;

/// Default agent ordering for the pipeline.
pub const DEFAULT_AGENTS: &[&str] = &[
    "architect",
    "designer",
    "migration",
    "developer",
    "accessibility",
    "tester",
    "performance",
    "secops",
    "dependency",
    "infrastructure",
    "devops",
    "rollback",
    "documentation",
    "reviewer",
];

/// Agents whose failure does NOT block the pipeline.
pub const NON_BLOCKING_AGENTS: &[&str] = &[
    "designer",
    "migration",
    "accessibility",
    "performance",
    "dependency",
    "rollback",
    "documentation",
];

pub fn is_blocking(agent: &str) -> bool {
    !NON_BLOCKING_AGENTS.contains(&agent)
}
