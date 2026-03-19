use std::path::Path;

use anyhow::{Context, Result};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrdStatus {
    Draft,
    Ready,
    InProgress,
    Done,
    Unknown,
}

impl PrdStatus {
    fn parse(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "draft" => Self::Draft,
            "ready" => Self::Ready,
            "in progress" | "in_progress" | "inprogress" => Self::InProgress,
            "done" => Self::Done,
            _ => Self::Unknown,
        }
    }
}

impl std::fmt::Display for PrdStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Draft => write!(f, "Draft"),
            Self::Ready => write!(f, "Ready"),
            Self::InProgress => write!(f, "In Progress"),
            Self::Done => write!(f, "Done"),
            Self::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Prd {
    pub title: String,
    pub status: PrdStatus,
    pub working_branch: Option<String>,
    pub priority: String,
    pub content: String,
}

impl Prd {
    /// Parse a PRD markdown file, extracting metadata from the blockquote header.
    pub fn load(path: &Path) -> Result<Self> {
        let content = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read PRD: {}", path.display()))?;
        Ok(Self::parse(&content, path))
    }

    fn parse(content: &str, path: &Path) -> Self {
        let title = extract_title(content).unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("untitled")
                .to_string()
        });

        let status = extract_field(content, "Status")
            .map(|s| PrdStatus::parse(&s))
            .unwrap_or(PrdStatus::Unknown);

        let working_branch = extract_field(content, "Working Branch");
        let priority = extract_field(content, "Priority").unwrap_or_else(|| "P2".into());

        Self {
            title,
            status,
            working_branch,
            priority,
            content: content.to_string(),
        }
    }

    pub fn is_done(&self) -> bool {
        self.status == PrdStatus::Done
    }

    pub fn slug(&self) -> String {
        slugify(&self.title)
    }
}

/// Extract the first `# heading` from markdown.
fn extract_title(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            let title = title.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

/// Extract a `> **Field**: value` from blockquote metadata.
fn extract_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("**{field}**:");
    let alt_prefix = format!("**{field}**:");
    for line in content.lines() {
        let trimmed = line.trim().trim_start_matches('>').trim();
        if let Some(rest) = trimmed
            .strip_prefix(&prefix)
            .or_else(|| trimmed.strip_prefix(&alt_prefix))
        {
            let value = rest.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

pub fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_title() {
        let md = "# My Feature PRD\n\n> **Status**: Ready\n";
        assert_eq!(extract_title(md), Some("My Feature PRD".into()));
    }

    #[test]
    fn test_extract_field() {
        let md = "> **Status**: Ready\n> **Priority**: P1\n> **Working Branch**: feature/test\n";
        assert_eq!(extract_field(md, "Status"), Some("Ready".into()));
        assert_eq!(extract_field(md, "Priority"), Some("P1".into()));
        assert_eq!(
            extract_field(md, "Working Branch"),
            Some("feature/test".into())
        );
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("My Feature PRD"), "my-feature-prd");
        assert_eq!(slugify("  Hello World! "), "hello-world");
    }

    #[test]
    fn test_prd_status_parse() {
        assert_eq!(PrdStatus::parse("Done"), PrdStatus::Done);
        assert_eq!(PrdStatus::parse("In Progress"), PrdStatus::InProgress);
        assert_eq!(PrdStatus::parse("draft"), PrdStatus::Draft);
    }
}
