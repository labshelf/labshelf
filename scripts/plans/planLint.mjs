// `plan lint <dir>`: structural checks of a plan folder beyond the schemas. Returns one string per problem.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadYamlFile, planPath } from "./planFiles.mjs";

const norm = (path) => path.replace(/\/+$/, "");
const covers = (outer, inner) => norm(inner) === norm(outer) || norm(inner).startsWith(`${norm(outer)}/`);
const overlaps = (a, b) => covers(a, b) || covers(b, a);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ids that appear more than once in `ids`. */
const duplicates = (ids) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

/** Finds one cycle in `graph` (Map id -> depends_on ids); returns the id path or null. */
function findCycle(graph) {
  const state = new Map(); // 1 visiting, 2 done
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2 || !graph.has(id)) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const next of graph.get(id)) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const id of graph.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

/** Checks that every dependency exists and that the graph has no cycle. `label` names the kind of node. */
function checkGraph(graph, label, problems) {
  for (const [id, deps] of graph) {
    for (const dep of deps) if (!graph.has(dep)) problems.push(`${label} ${id}: depends_on ${dep} does not exist`);
  }
  const cycle = findCycle(graph);
  if (cycle) problems.push(`${label} depends_on cycle: ${cycle.join(" -> ")}`);
}

/** True when `from` reaches `to` through depends_on edges of `graph`. */
function reaches(graph, from, to, seen = new Set()) {
  if (seen.has(from)) return false;
  seen.add(from);
  return (graph.get(from) ?? []).some((dep) => dep === to || reaches(graph, dep, to, seen));
}

function loadAll(dir, problems) {
  const guarded = (file, kind) => {
    try {
      return loadYamlFile(join(dir, file), kind);
    } catch (error) {
      problems.push(...String(error.message).replaceAll(`${dir}/`, "").split("\n"));
      return null;
    }
  };
  const plan = guarded("plan.yaml", "plan");
  const sessions = [];
  for (const entry of plan?.sessions ?? []) {
    const session = guarded(entry.file, "session");
    if (!session) continue;
    if (session.id !== entry.id) problems.push(`${entry.file}: id ${session.id} does not match plan session ${entry.id}`);
    sessions.push({ file: entry.file, session });
  }
  return { plan, sessions };
}

function checkSessions(plan, sessions, problems) {
  for (const id of duplicates(plan.sessions.map((s) => s.id))) problems.push(`plan.yaml: duplicate session id ${id}`);
  checkGraph(new Map(plan.sessions.map((s) => [s.id, s.depends_on])), "session", problems);
  for (const { file, session } of sessions) {
    const entry = plan.sessions.find((s) => s.id === session.id);
    if (entry && JSON.stringify(entry.depends_on) !== JSON.stringify(session.depends_on)) problems.push(`${file}: depends_on differs from plan.yaml`);
  }
}

function checkSpecs(plan, sessions, problems) {
  const specs = sessions.flatMap(({ file, session }) => session.packages.map((spec) => ({ file, session, spec })));
  for (const id of duplicates(specs.map((s) => s.spec.id))) problems.push(`duplicate spec id ${id}`);
  const graph = new Map(specs.map(({ spec }) => [spec.id, spec.depends_on ?? []]));
  checkGraph(graph, "spec", problems);

  for (const { file, session } of sessions) {
    const own = specs.filter((s) => s.session === session);
    for (const { spec } of own) {
      for (const path of [...spec.edit.map((e) => e.path), ...(spec.create ?? [])]) {
        if (!session.owns.some((owned) => covers(owned, path))) problems.push(`${file}: spec ${spec.id} path ${path} is outside the session owns`);
      }
    }
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        const [a, b] = [own[i].spec, own[j].spec];
        if (reaches(graph, a.id, b.id) || reaches(graph, b.id, a.id)) continue;
        const writes = (spec) => [...spec.edit.map((e) => e.path), ...(spec.create ?? [])];
        for (const pa of writes(a)) {
          for (const pb of writes(b)) {
            if (overlaps(pa, pb)) problems.push(`${file}: specs ${a.id} and ${b.id} are not ordered by depends_on but both write ${pa === pb ? pa : `${pa} / ${pb}`}`);
          }
        }
      }
    }
  }

  const covered = new Set(specs.flatMap(({ spec }) => spec.acceptance.map((a) => a.id)));
  for (const { id } of plan.acceptance) if (!covered.has(id)) problems.push(`plan.yaml: acceptance ${id} appears in no spec`);
  return specs;
}

function checkTests(root, specs, problems) {
  for (const { file, spec } of specs) {
    if (!spec.tests || "none" in spec.tests) continue;
    const texts = [];
    for (const hidden of spec.tests.hidden) {
      if (existsSync(join(root, hidden))) texts.push(readFileSync(join(root, hidden), "utf8"));
      else problems.push(`${file}: spec ${spec.id} hidden test ${hidden} does not exist`);
    }
    if (texts.length === 0) continue;
    const text = texts.join("\n");
    for (const { id } of spec.acceptance) {
      const named = new RegExp(`\\b(?:it|test)(?:\\.\\w+)?\\(\\s*(["'\`])${escapeRegExp(id)}(?![\\w.])`);
      if (!named.test(text)) problems.push(`${file}: spec ${spec.id} acceptance ${id} starts no test name in its hidden tests`);
    }
  }
}

/** Lints the plan folder `dir` (absolute); `root` is the repo root that spec paths are relative to. */
export function planLint(root, dir) {
  const problems = [];
  if (!existsSync(planPath(dir))) return [`plan.yaml: not found in ${dir}`];
  const { plan, sessions } = loadAll(dir, problems);
  if (!plan) return problems;
  checkSessions(plan, sessions, problems);
  checkTests(root, checkSpecs(plan, sessions, problems), problems);
  return problems;
}
