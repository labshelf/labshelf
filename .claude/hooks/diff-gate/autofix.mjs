// Auto-fix for unused exports whose symbol is still used inside its own file: drop the `export` keyword from the declaration line.
// A pure text edit on the flagged line only; `export default`, export lists, re-exports and multi-declarator lines are left alone.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Returns the line without its `export` keyword, or null when the line is not a plain declaration of `name`.
export function stripExport(line, name) {
  const re = new RegExp(`^(\\s*)export\\s+((?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:const\\s+enum\\s+|const\\s+|let\\s+|var\\s+|function\\s*\\*?\\s*|class\\s+|interface\\s+|type\\s+|enum\\s+)${esc(name)}(?![\\w$]).*)$`);
  const m = line.match(re);
  return m === null ? null : `${m[1]}${m[2]}`;
}

// Applies the fixes in place. Returns { applied: ["file:line:symbol"], failed: [violation] }.
export function applyAutofixes(root, violations) {
  const applied = [];
  const failed = [];
  const byFile = new Map();
  for (const violation of violations) {
    if (violation.symbol === undefined || violation.line === undefined) failed.push(violation);
    else byFile.set(violation.file, [...(byFile.get(violation.file) ?? []), violation]);
  }
  for (const [file, group] of byFile) {
    let text;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      failed.push(...group);
      continue;
    }
    const lines = text.split("\n");
    let changed = false;
    for (const violation of group) {
      const index = violation.line - 1;
      const fixed = index >= 0 && index < lines.length ? stripExport(lines[index], violation.symbol) : null;
      if (fixed === null) {
        failed.push(violation);
        continue;
      }
      lines[index] = fixed;
      changed = true;
      applied.push(`${file}:${violation.line}:${violation.symbol}`);
    }
    if (changed) writeFileSync(join(root, file), lines.join("\n"));
  }
  return { applied, failed };
}
