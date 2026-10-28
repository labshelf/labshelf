// `plan status`: one line per plan under documents/plans/, as the session-start hook prints it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPlan, loadSession, planPath } from "./planFiles.mjs";
import { pendingSessions } from "./planQueue.mjs";

const NEXT_MAX = 90;
const OPEN_ROW = /^\|.*\[ \][ \t]*\|?[ \t]*$/;

const readLines = (file) => readFileSync(file, "utf8").split("\n");

// Open and total checklist lines over all session files; a line counts once however many boxes it holds.
function mdCounts(queue) {
  let open = 0, total = 0;
  for (const { file } of queue) {
    for (const line of readLines(file)) {
      if (line.includes("[ ]")) open++;
      if (/\[( |x)\]/i.test(line)) total++;
    }
  }
  return { open, total };
}

// The first unticked table row of the first session that has one, as "<id> <title>".
function mdNext(queue) {
  for (const { file } of queue) {
    const row = readLines(file).find((line) => OPEN_ROW.test(line));
    if (row === undefined) continue;
    const [, id = "", title = ""] = row.split("|");
    return `${id.trim()} ${title.trim()}`.slice(0, NEXT_MAX);
  }
  return "";
}

function mdState(planDir) {
  const queue = pendingSessions(planDir);
  const status = readLines(join(planDir, "plan.md")).find((line) => line.startsWith("Status:"));
  return { ...mdCounts(queue), status: status?.replace(/^Status: */, "") ?? "", next: mdNext(queue) };
}

function yamlState(planDir) {
  const dir = join(planDir, "sessions");
  const ids = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".yaml")).map((n) => n.slice(0, -5)) : [];
  const sessions = ids.map((id) => loadSession(planDir, id));
  const [first] = pendingSessions(planDir);
  const next = first ? sessions.find((s) => s.id === first.id) : undefined;
  return {
    open: sessions.filter((s) => s.status !== "done").length,
    total: sessions.length,
    status: loadPlan(planDir).status,
    next: next ? `${next.id} ${next.goal}`.slice(0, NEXT_MAX) : "",
  };
}

/** The plan folders under `documents/plans` (the TEMPLATE folder excluded), each with a `plan.md` or `plan.yaml`. */
function planDirs(root) {
  const plansDir = join(root, "documents", "plans");
  if (!existsSync(plansDir)) return [];
  return readdirSync(plansDir)
    .sort()
    .filter((name) => name !== "TEMPLATE" && (existsSync(join(plansDir, name, "plan.md")) || existsSync(planPath(join(plansDir, name)))));
}

/** One line per plan: `  - documents/plans/<slug>: <open>/<total> open · status: <s> · next: <id> <title>`. Empty when there are no plans. */
export function planStatus(root) {
  return planDirs(root).map((name) => {
    const planDir = join(root, "documents", "plans", name);
    const label = `documents/plans/${name}`;
    try {
      const { open, total, status, next } = existsSync(planPath(planDir)) ? yamlState(planDir) : mdState(planDir);
      return `  - ${label}: ${open}/${total} open${status ? ` · status: ${status}` : ""}${next ? ` · next: ${next}` : ""}`;
    } catch (error) {
      return `  - ${label}: unreadable (${String(error?.message ?? error).split("\n")[0]})`;
    }
  });
}
