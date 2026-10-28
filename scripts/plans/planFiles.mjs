// Plan and session YAML on disk: load and save through the schema validators (scripts/agents/schemas.mjs).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import { validate } from "../agents/schemas.mjs";

/** Reads a YAML file and validates it against `kind`; throws an Error listing every problem. */
export function loadYamlFile(file, kind) {
  let value;
  try {
    value = parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${String(error?.message ?? error).split("\n")[0]}`);
  }
  const errors = validate(kind, value);
  if (errors.length > 0) throw new Error(errors.map((e) => `${file}: ${e}`).join("\n"));
  return value;
}

/** Validates `value`, then writes it as YAML with the `schema` key first (any `schema` already in `value` is replaced). */
function saveYamlFile(file, kind, value) {
  const { schema: _schema, ...rest } = value;
  const document = { schema: `${kind}/v1`, ...rest };
  const errors = validate(kind, document);
  if (errors.length > 0) throw new Error(errors.map((e) => `${file}: ${e}`).join("\n"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, stringify(document, { lineWidth: 0 }));
}

export const planPath = (dir) => join(dir, "plan.yaml");
export const sessionPath = (dir, id) => join(dir, "sessions", `${id}.yaml`);

export const loadPlan = (dir) => loadYamlFile(planPath(dir), "plan");
export const loadSession = (dir, id) => loadYamlFile(sessionPath(dir, id), "session");
export const savePlan = (dir, plan) => saveYamlFile(planPath(dir), "plan", plan);
/** A session file is written under `sessions/<session.id>.yaml`. */
export const saveSession = (dir, session) => saveYamlFile(sessionPath(dir, session.id), "session", session);

/** Finds the first folder named `plan.yaml` holds, walking up from `start`; null when none. */
function planDirAbove(start) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(planPath(dir))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Picks the plan folder for a command without a dir argument: `--plan <slug|dir>`, else the plan folder above `near`
 * (a brief file) or above `cwd`, else the only plan under documents/plans. Throws when none or several match.
 */
export function resolvePlanDir(root, { plan, near, cwd = process.cwd() } = {}) {
  if (typeof plan === "string") {
    const dir = existsSync(planPath(resolve(cwd, plan))) ? resolve(cwd, plan) : join(root, "documents", "plans", plan);
    if (!existsSync(planPath(dir))) throw new Error(`no plan.yaml for --plan ${plan}`);
    return dir;
  }
  const above = (near && planDirAbove(near)) || planDirAbove(cwd);
  if (above) return above;
  const plansDir = join(root, "documents", "plans");
  const all = existsSync(plansDir) ? readdirSync(plansDir).filter((name) => existsSync(planPath(join(plansDir, name)))) : [];
  if (all.length === 1) return join(plansDir, all[0]);
  throw new Error(all.length === 0 ? "no plan found under documents/plans" : `several plans found (${all.join(", ")}); pass --plan <slug>`);
}

/** Finds package `specId` in session `sessionId` of the plan at `dir`; throws when the session or the spec is missing. */
export function findSpec(dir, sessionId, specId) {
  const spec = loadSession(dir, sessionId).packages.find((p) => p.id === specId);
  if (!spec) throw new Error(`spec ${specId} not found in session ${sessionId}`);
  return spec;
}
