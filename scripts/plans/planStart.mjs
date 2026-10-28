// `plan start <session> <id>`: copies the hidden tests into place, adds the missing seam stubs and emits `package_started`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { emit } from "../agents/telemetry.mjs";
import { findSpec } from "./planFiles.mjs";
import { hiddenTargets } from "./planTests.mjs";
import { writeStubs } from "./planStubs.mjs";

/** Returns `{ copied, created, appended }` (repo-relative paths). Throws before writing anything when a hidden test is missing. */
export function planStart(root, { planDir, sessionId, specId }) {
  const spec = findSpec(planDir, sessionId, specId);
  const targets = spec.tests?.hidden ? hiddenTargets(spec) : [];
  for (const { from } of targets) if (!existsSync(join(root, from))) throw new Error(`plan start: hidden test ${from} does not exist (run plan tests first)`);
  for (const { from, to } of targets) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    copyFileSync(join(root, from), join(root, to));
  }
  const stubs = writeStubs(root, spec);
  emit("package_started", { plan: spec.plan, session: sessionId, spec: spec.id, level: spec.level, model: spec.runner.model });
  return { copied: targets.map((t) => t.to), ...stubs };
}
