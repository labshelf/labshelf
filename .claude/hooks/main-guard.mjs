#!/usr/bin/env node
// PreToolUse hook: in an unattended plan session (runPlan.mjs sets LABSHELF_PLAN and LABSHELF_PLAN_SESSION), the main
// thread edits only documents/ (its plan folder, contracts and docs for task packages); code changes go to an implementer. The plan's
// tests are not the main thread's either: documents/plans/*/tests/ and their in-place copies (a repo path that also sits under
// documents/plans/<slug>/tests/<id>/) are denied with a reason that routes the change to the tester after an arbiter verdict.
// Subagents and attended sessions pass untouched, and so does a headless arbiter or tester that run.mjs spawns: it carries
// LABSHELF_ROLE (and no LABSHELF_PLAN_SESSION), and spec-guard keeps it inside its spec.
// Bash is not checked: guard-bash has no write detection, so a redirect or `sed -i` in the main thread still passes.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

const FILE_TOOLS = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const REASON = (planDir) =>
  `Unattended run: the main thread edits only documents/ (plan ${planDir}/, contracts, docs). Turn this work into a spec package in the session file and run it with an implementer.`;

const TEST_REASON =
  'Unattended run: the main thread never edits a test (documents/plans/*/tests/ or its in-place copy). Send a blocked or suspect test to the arbiter; only the tester changes it, after a test_wrong verdict.';
const PLAN_TESTS = /^documents\/plans\/[^/]+\/tests(\/|$)/;

// Whether `rel` is a plan test or the in-place copy of one of this plan's tests.
function isTest(root, slug, rel) {
  if (PLAN_TESTS.test(rel)) return true;
  const dir = join(root, 'documents', 'plans', slug, 'tests');
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((id) => existsSync(join(dir, id, rel)));
}

// Repo-relative form of a path, or undefined when it leaves the repository.
function normalise(root, cwd, path) {
  const rel = relative(root, resolve(cwd, path));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split('\\').join('/');
}

function main(input) {
  const slug = process.env.LABSHELF_PLAN;
  if (!slug || !process.env.LABSHELF_PLAN_SESSION || process.env.LABSHELF_ROLE || input.agent_id || !(input.tool_name in FILE_TOOLS)) return;
  const target = input.tool_input?.[FILE_TOOLS[input.tool_name]];
  const cwd = input.cwd ?? process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const planDir = `documents/plans/${slug}`;
  const rel = typeof target === 'string' ? normalise(root, cwd, target) : undefined;
  const test = rel !== undefined && isTest(root, slug, rel);
  if (!test && rel !== undefined && rel.startsWith('documents/')) return;
  emit('main_edit_deny', { tool: input.tool_name, target: String(target ?? ''), session_id: input.session_id });
  const reason = test ? TEST_REASON : REASON(planDir);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

try {
  main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
