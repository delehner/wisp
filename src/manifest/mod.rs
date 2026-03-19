use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub orders: Vec<Order>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Order {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub prds: Vec<PrdEntry>,
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
    /// are resolved relative to the directory containing the manifest file.
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read manifest: {}", path.display()))?;
        let mut manifest: Self = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse manifest: {}", path.display()))?;

        let base_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();

        manifest.resolve_paths(&base_dir);
        Ok(manifest)
    }

    /// Resolve relative PRD and context paths against the manifest's directory.
    fn resolve_paths(&mut self, base_dir: &Path) {
        for order in &mut self.orders {
            for prd_entry in &mut order.prds {
                if prd_entry.prd.is_relative() {
                    prd_entry.prd = base_dir.join(&prd_entry.prd);
                }
                for repo in &mut prd_entry.repositories {
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
}
