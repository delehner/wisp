use std::path::Path;

use anyhow::{Context, Result};

const SKILL_ORDER: &[&str] = &[
    "overview",
    "architecture",
    "conventions",
    "components",
    "api",
    "database",
    "testing",
    "build-deploy",
    "environment",
    "integrations",
];

/// Assemble context skill files from a directory into a single markdown string.
/// Skills are ordered canonically, with remaining files appended alphabetically.
pub fn assemble_skills(context_dir: &Path) -> Result<String> {
    if !context_dir.is_dir() {
        // Single-file context (backward compatibility)
        if context_dir.is_file() {
            return std::fs::read_to_string(context_dir).with_context(|| {
                format!("failed to read context file: {}", context_dir.display())
            });
        }
        anyhow::bail!("context path does not exist: {}", context_dir.display());
    }

    let mut ordered_files: Vec<std::path::PathBuf> = Vec::new();
    let mut seen: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();

    // Canonical order first
    for skill in SKILL_ORDER {
        let path = context_dir.join(format!("{skill}.md"));
        if path.is_file() {
            ordered_files.push(path.clone());
            seen.insert(path);
        }
    }

    // Remaining .md files alphabetically
    let mut remaining: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(context_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("md") && !seen.contains(&path) {
                remaining.push(path);
            }
        }
    }
    remaining.sort();
    ordered_files.extend(remaining);

    if ordered_files.is_empty() {
        return Ok("<!-- No context skills found -->\n".into());
    }

    let mut output = String::new();
    for (i, file) in ordered_files.iter().enumerate() {
        if i > 0 {
            output.push_str("\n---\n\n");
        }
        let content = std::fs::read_to_string(file)
            .with_context(|| format!("failed to read skill: {}", file.display()))?;
        output.push_str(&strip_frontmatter(&content));
    }

    Ok(output)
}

/// Strip YAML frontmatter (between `---` markers at the start of a file).
fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    if let Some(end_pos) = after_first.find("\n---") {
        let rest = &after_first[end_pos + 4..];
        return rest.trim_start_matches('\n').to_string();
    }

    content.to_string()
}

/// Write an assembled context file to the given output path.
pub fn write_context_file(context_dir: &Path, output: &Path) -> Result<()> {
    let content = assemble_skills(context_dir)?;
    std::fs::write(output, &content)
        .with_context(|| format!("failed to write context: {}", output.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_frontmatter() {
        let with_fm = "---\nname: test\ndescription: foo\n---\n# Content\nHello";
        assert_eq!(strip_frontmatter(with_fm), "# Content\nHello");

        let without_fm = "# Content\nHello";
        assert_eq!(strip_frontmatter(without_fm), "# Content\nHello");
    }
}
