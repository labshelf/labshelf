// The sessions a plan still has to run, in run order: `.md` plans by file name, YAML plans by `depends_on`.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadSession, planPath } from "./planFiles.mjs";

// Ids sort by numeric prefix, then by suffix: 2 < 2b < 10 < 10a < 10-rest.
function idKey(id) {
  const match = /^(\d+)(.*)$/.exec(id);
  return match ? [Number(match[1]), match[2]] : [Infinity, id];
}

function compareIds(a, b) {
  const [na, sa] = idKey(a), [nb, sb] = idKey(b);
  return na - nb || sa.localeCompare(sb);
}

function mdQueue(sessionsDir) {
  if (!existsSync(sessionsDir)) return { queue: [], skipped: [] };
  const queue = readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort(compareIds)
    .map((id) => ({ id, file: join(sessionsDir, `${id}.md`), format: "md" }));
  return { queue, skipped: [] };
}

function yamlQueue(planDir) {
  const sessionsDir = join(planDir, "sessions");
  const sessions = new Map();
  if (existsSync(sessionsDir)) {
    for (const name of readdirSync(sessionsDir).filter((n) => n.endsWith(".yaml"))) {
      const session = loadSession(planDir, name.slice(0, -5));
      sessions.set(session.id, session);
    }
  }
  // A dependency whose file is gone (a closed session) or marked done is satisfied.
  const open = [...sessions.values()].filter((s) => s.status !== "done");
  const openIds = new Set(open.map((s) => s.id));
  const unrunnable = new Map(); // id -> the blocked session it stems from, for blocked sessions and everything that depends on one
  for (const s of open.filter((o) => o.status === "blocked")) unrunnable.set(s.id, s.id);

  const queue = [];
  const placed = new Set();
  const skipped = [];
  const waiting = open.filter((s) => s.status === "pending").sort((a, b) => compareIds(a.id, b.id));
  for (let progress = true; progress && waiting.length > 0;) {
    progress = false;
    for (let i = 0; i < waiting.length; i++) {
      const s = waiting[i];
      const deps = (s.depends_on ?? []).filter((d) => openIds.has(d));
      const stuck = deps.find((d) => unrunnable.has(d));
      if (stuck !== undefined) {
        const root = unrunnable.get(stuck);
        unrunnable.set(s.id, root);
        skipped.push({ id: s.id, reason: `depends on blocked session ${root}${root === stuck ? "" : ` (through ${stuck})`}` });
      } else if (deps.every((d) => placed.has(d))) {
        queue.push({ id: s.id, file: join(sessionsDir, `${s.id}.yaml`), format: "yaml" });
        placed.add(s.id);
      } else continue;
      waiting.splice(i, 1);
      progress = true;
      break; // restart from the lowest id so the tie-break stays numeric
    }
  }
  for (const s of waiting) skipped.push({ id: s.id, reason: "dependency cycle" });
  skipped.sort((a, b) => compareIds(a.id, b.id));
  return { queue, skipped };
}

/** `{queue, skipped}`: runnable sessions in order as `{id, file, format}`, and `{id, reason}` for those left out. */
export function planQueue(planDir) {
  return existsSync(planPath(planDir)) ? yamlQueue(planDir) : mdQueue(join(planDir, "sessions"));
}

/** The runnable sessions of the plan in `planDir`, in run order. */
export const pendingSessions = (planDir) => planQueue(planDir).queue;
