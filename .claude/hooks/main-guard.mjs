#!/usr/bin/env node
// PreToolUse hook: in an unattended plan session (runPlan.mjs sets LABSHELF_PLAN and LABSHELF_PLAN_SESSION), the main
// thread edits only its plan folder; code changes go to an implementer. Subagents and attended sessions pass untouched.
// Bash is not checked: guard-bash has no write detection, so a redirect or `sed -i` in the main thread still passes.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

const FILE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const REASON = (planDir) =>
  `Unattended run: the main thread edits only ${planDir}/. Turn this work into a spec package in the session file and run it with an implementer.`;

// Repo-relative form of a path, or undefined when it leaves the repository.
function normalise(root, cwd, path) {
  const rel = relative(root, resolve(cwd, path));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split('\\').join('/');
}

function main(input) {
  const slug = process.env.LABSHELF_PLAN;
  if (!slug || !process.env.LABSHELF_PLAN_SESSION || input.agent_id || !(input.tool_name in FILE_TOOLS)) return;
  const target = input.tool_input?.[FILE_TOOLS[input.tool_name]];
  const cwd = input.cwd ?? process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const planDir = `documents/plans/${slug}`;
  const rel = typeof target === 'string' ? normalise(root, cwd, target) : undefined;
  if (rel !== undefined && rel.startsWith(`${planDir}/`)) return;
  emit('main_edit_deny', { tool: input.tool_name, target: String(target ?? ''), session_id: input.session_id });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON(planDir) } }));
}

try {
  main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
