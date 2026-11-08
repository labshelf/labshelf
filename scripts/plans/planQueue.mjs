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
  // A dependency whose file is gone (a closed session) or marked done is satisfied. Every other session is queued: a
  // session whose dependency is unfinished (carried, or the legacy `blocked`) still runs after it, and the runner hands it
  // the dependency's unfinished packages to resolve first.
  const open = [...sessions.values()].filter((s) => s.status !== "done");
  const openIds = new Set(open.map((s) => s.id));
  const queue = [];
  const placed = new Set();
  const waiting = open.sort((a, b) => compareIds(a.id, b.id));
  const place = (s) => {
    queue.push({ id: s.id, file: join(sessionsDir, `${s.id}.yaml`), format: "yaml" });
    placed.add(s.id);
  };
  for (let progress = true; progress && waiting.length > 0;) {
    progress = false;
    for (let i = 0; i < waiting.length; i++) {
      const s = waiting[i];
      if (!(s.depends_on ?? []).filter((d) => openIds.has(d)).every((d) => placed.has(d))) continue;
      place(s);
      waiting.splice(i, 1);
      progress = true;
      break; // restart from the lowest id so the tie-break stays numeric
    }
  }
  // A dependency cycle is a planning bug; its sessions still run, in id order, after the rest.
  const skipped = [];
  for (const s of waiting) {
    place(s);
    skipped.push({ id: s.id, reason: "dependency cycle (queued last, in id order)" });
  }
  return { queue, skipped };
}

/** `{queue, skipped}`: every unfinished session in run order as `{id, file, format}`; `skipped` only notes a cycle, whose sessions are still queued. */
export function planQueue(planDir) {
  return existsSync(planPath(planDir)) ? yamlQueue(planDir) : mdQueue(join(planDir, "sessions"));
}

/** The unfinished sessions of the plan in `planDir`, in run order. */
export const pendingSessions = (planDir) => planQueue(planDir).queue;
