use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::config::{AgentIterationOverrides, Config};

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Default max Ralph Loop iterations per agent when no per-agent override applies.
    #[serde(default)]
    pub max_iterations: Option<u32>,
    /// Per-agent max iterations for this manifest (partial overrides).
    #[serde(default)]
    pub agent_max_iterations: Option<AgentIterationOverrides>,
    #[serde(rename = "epics", alias = "orders")]
    pub epics: Vec<Epic>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Epic {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(rename = "subtasks", alias = "prds")]
    pub subtasks: Vec<PrdEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrdEntry {
    pub prd: PathBuf,
    #[serde(default)]
    pub agents: Option<Vec<String>>,
    pub repositories: Vec<Repository>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Repository {
    pub url: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default)]
    pub context: Option<PathBuf>,
    #[serde(default)]
    pub agents: Option<Vec<String>>,
}

fn default_branch() -> String {
    "main".into()
}

impl Manifest {
    /// Load and parse a manifest JSON file. Paths within the manifest
    /// are resolved relative to the current working directory (project root).
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read manifest: {}", path.display()))?;
        let mut manifest: Self = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse manifest: {}", path.display()))?;

        let base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

        manifest.resolve_paths(&base_dir);
        Ok(manifest)
    }

    /// Resolve relative PRD and context paths against the current working directory.
    fn resolve_paths(&mut self, base_dir: &Path) {
        for epic in &mut self.epics {
            for subtask in &mut epic.subtasks {
                if subtask.prd.is_relative() {
                    subtask.prd = base_dir.join(&subtask.prd);
                }
                for repo in &mut subtask.repositories {
                    if let Some(ctx) = &mut repo.context {
                        if ctx.is_relative() {
                            *ctx = base_dir.join(&*ctx);
                        }
                    }
                }
            }
        }
    }

    pub fn display_name(&self) -> &str {
        self.name.as_deref().unwrap_or("Unnamed")
    }

    /// Effective default max iterations for pipelines driven by this manifest.
    pub fn pipeline_max_iterations(&self, config: &Config) -> u32 {
        self.max_iterations.unwrap_or(config.max_iterations)
    }

    /// Per-agent overrides from the manifest (empty if unset).
    pub fn manifest_agent_max_iterations(&self) -> AgentIterationOverrides {
        self.agent_max_iterations.clone().unwrap_or_default()
    }
}

/// Ensures `wisp generate prd` tells the model (and post-processing) to use a `.json` manifest path.
pub fn normalize_generate_prd_manifest_path(path: &Path) -> PathBuf {
    match path.extension().and_then(|e| e.to_str()) {
        Some("json") => path.to_path_buf(),
        _ => path.with_extension("json"),
    }
}

/// After `wisp generate prd`, stamp `max_iterations` and `agent_max_iterations` from the
/// current [`Config`] (env / CLI) so the manifest is self-describing. Overwrites those keys.
pub fn inject_iteration_defaults(path: &Path, config: &Config) -> Result<()> {
    let base_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut path = if path.is_relative() {
        base_dir.join(path)
    } else {
        path.to_path_buf()
    };

    if !path.is_file() {
        let with_json = path.with_extension("json");
        if with_json.is_file() {
            tracing::info!(
                manifest_path = %with_json.display(),
                "using manifest path with .json extension for iteration injection"
            );
            path = with_json;
        }
    }

    let content = std::fs::read_to_string(&path).with_context(|| {
        format!(
            "failed to read manifest for iteration injection: {}",
            path.display()
        )
    })?;
    let mut root: serde_json::Value = serde_json::from_str(&content)
        .with_context(|| format!("failed to parse manifest JSON: {}", path.display()))?;

    let obj = root
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("manifest root must be a JSON object"))?;

    obj.insert(
        "max_iterations".to_string(),
        serde_json::json!(config.max_iterations),
    );

    let agents_val = serde_json::to_value(&config.agent_max_iterations)
        .with_context(|| "serialize agent_max_iterations for manifest")?;
    obj.insert("agent_max_iterations".to_string(), agents_val);

    let out = serde_json::to_string_pretty(&root).context("serialize manifest JSON")?;
    std::fs::write(&path, out)
        .with_context(|| format!("failed to write manifest: {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_optional_iteration_fields() {
        let json = r#"{
            "name": "T",
            "epics": []
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert!(m.max_iterations.is_none());
        assert!(m.agent_max_iterations.is_none());
    }

    #[test]
    fn manifest_deserializes_legacy_orders_key() {
        let json = r#"{
            "name": "T",
            "orders": []
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert!(m.epics.is_empty());
    }

    #[test]
    fn manifest_deserializes_iteration_overrides() {
        let json = r#"{
            "name": "T",
            "max_iterations": 7,
            "agent_max_iterations": { "developer": 12 },
            "epics": []
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.max_iterations, Some(7));
        assert_eq!(m.agent_max_iterations.as_ref().unwrap().developer, Some(12));
    }

    #[test]
    fn epic_deserializes_subtasks_and_legacy_prds() {
        let json = r#"{
            "name": "M",
            "epics": [
                {
                    "name": "E1",
                    "subtasks": [
                        { "prd": "./a.md", "repositories": [{ "url": "https://github.com/o/r" }] }
                    ]
                }
            ]
        }"#;
        let m: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.epics.len(), 1);
        assert_eq!(m.epics[0].subtasks.len(), 1);

        let json_legacy = r#"{
            "name": "M",
            "orders": [
                {
                    "prds": [
                        { "prd": "./b.md", "repositories": [{ "url": "https://github.com/o/r2" }] }
                    ]
                }
            ]
        }"#;
        let m2: Manifest = serde_json::from_str(json_legacy).unwrap();
        assert_eq!(m2.epics[0].subtasks.len(), 1);
    }

    #[test]
    fn normalize_generate_prd_manifest_path_adds_json() {
        assert_eq!(
            normalize_generate_prd_manifest_path(Path::new("manifests/foo")),
            PathBuf::from("manifests/foo.json")
        );
    }

    #[test]
    fn normalize_generate_prd_manifest_path_keeps_json() {
        assert_eq!(
            normalize_generate_prd_manifest_path(Path::new("manifests/foo.json")),
            PathBuf::from("manifests/foo.json")
        );
    }

    #[test]
    fn normalize_generate_prd_manifest_path_replaces_non_json_ext() {
        assert_eq!(
            normalize_generate_prd_manifest_path(Path::new("manifests/foo.txt")),
            PathBuf::from("manifests/foo.json")
        );
    }
}
