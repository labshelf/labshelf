#!/usr/bin/env node
// PostToolUse hook on Edit|Write|MultiEdit: after an edit under packages/*/src it fingerprints the functions the edit added or
// changed and matches them against the code-facts index. A match in another file that is an exact copy (T1/T2), at least 0.8 similar,
// or carries the same name at 0.6 comes back as additionalContext (at most 3 lines, each pair once per agent), so the edit reuses
// it. Acts only when the database exists and LABSHELF_DUP_GUARD is not "off". Never denies; any error: no output, exit 0.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

const TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const SOURCE = /^packages\/[^/]+\/src\/.+\.tsx?$/;
const MAX_LINES = 3;
const SIMILAR_MIN = 0.8;
const SAME_NAME_MIN = 0.6;
const MIN_NODES = 10;

const safeId = (text) => String(text).replace(/[^\w.-]/g, '_');
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const clip = (text, max = 110) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

// 1-based line ranges that each `needle` occupies in `text`; an empty or missing needle occupies none.
function rangesOf(text, needle) {
  const ranges = [];
  if (typeof needle !== 'string' || !needle) return ranges;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const start = text.slice(0, at).split('\n').length;
    ranges.push([start, start + needle.split('\n').length - 1]);
  }
  return ranges;
}

function stateFileOf(input) {
  const dir = process.env.LABSHELF_HOOK_STATE_DIR ?? join(tmpdir(), 'labshelf-hooks');
  return join(dir, safeId(input.session_id ?? 'nosession'), `${safeId(input.agent_id ?? 'main')}-dup.json`);
}

const reasonOf = (hit) => (hit.exact ? 'exact' : hit.similarity >= SIMILAR_MIN ? 'similar' : 'name');
const scoreOf = (hit) => `${hit.exact ? `${hit.exact} ` : ''}${hit.similarity.toFixed(2)}`;
const isWarnable = (hit) => hit.exact || hit.similarity >= SIMILAR_MIN || (hit.sameName && hit.similarity >= SAME_NAME_MIN);

async function main(input) {
  if (!TOOLS.has(input.tool_name) || process.env.LABSHELF_DUP_GUARD === 'off') return;
  const target = input.tool_input?.file_path;
  if (typeof target !== 'string' || !target) return;
  const cwd = input.cwd ?? process.cwd();
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? cwd);
  const rel = relative(root, resolve(cwd, target)).split('\\').join('/');
  if (rel.startsWith('..') || isAbsolute(rel) || !SOURCE.test(rel) || rel.endsWith('.d.ts')) return;
  const dbPath = process.env.LABSHELF_FACTS_DB ?? join(root, '.code-facts', 'facts.db');
  if (!existsSync(dbPath)) return;

  const started = Date.now();
  const { unitsOfSource, matchPrint } = await import('../../scripts/code/match.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const text = readFileSync(resolve(cwd, target), 'utf8');
  let units = unitsOfSource(rel, text).filter((unit) => unit.print.nodes >= MIN_NODES);
  if (input.tool_name !== 'Write') {
    const edits = input.tool_name === 'MultiEdit' ? (input.tool_input.edits ?? []) : [input.tool_input];
    const ranges = edits.flatMap((edit) => rangesOf(text, edit?.new_string));
    units = units.filter((unit) => ranges.some(([from, to]) => unit.startLine <= to && unit.endLine >= from));
  }

  const stateFile = stateFileOf(input);
  const warned = new Set(readJson(stateFile)?.warned ?? []);
  const lines = [];
  const events = [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const unit of units) {
      for (const hit of matchPrint(db, unit.print, { excludeFile: rel, name: unit.label }).filter(isWarnable)) {
        if (lines.length >= MAX_LINES) break;
        const other = hit.unit;
        const otherLabel = other.owner ? `${other.owner}.${other.name}` : other.name;
        const key = `${rel}:${unit.label}>${other.file}:${otherLabel}`;
        if (warned.has(key)) continue;
        warned.add(key);
        lines.push(
          `possible duplicate: ${unit.label} (${rel}:${unit.startLine}) ≈ ${other.file}:${other.start_line} ${otherLabel} ${clip(other.signature)} (${scoreOf(hit)}, ${other.exported ? 'exported' : 'private'}): reuse or extend it, or say why not in the report`,
        );
        events.push({ unit: `${rel}:${unit.startLine} ${unit.label}`, match: `${other.file}:${other.start_line} ${otherLabel}`, score: Number(hit.similarity.toFixed(2)), reason: reasonOf(hit) });
        break; // the best warnable match of a unit is enough
      }
    }
  } finally {
    db.close();
  }
  if (lines.length > 0) {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ warned: [...warned] }));
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') } }));
  }
  emit('dup_check', { units: units.length, warned: lines.length, ms: Date.now() - started });
  for (const event of events) emit('dup_warning', event);
}

try {
  await main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
