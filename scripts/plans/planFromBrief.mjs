// `plan from-brief <brief.yaml> --spec <id> [--session <sid>]`: adds or merges a draft spec into a session file.
import { loadPlan, loadSession, loadYamlFile, saveSession } from "./planFiles.mjs";

// Union of two lists keeping every existing entry first; an entry is a duplicate when `key` matches.
const union = (existing = [], added = [], key = JSON.stringify) => {
  const seen = new Set(existing.map(key));
  return [...existing, ...added.filter((item) => !seen.has(key(item)))];
};
const refKey = (item) => `${item.path}|${item.lines}`;
const callerKey = (item) => `${item.symbol}|${item.path}|${item.lines}`;

/**
 * Reads the brief and adds spec `specId` to session `sessionId` (default: the part of the id before the first dot) of the plan at `planDir`.
 * A new spec gets edit/read/callers/commands/sha from the brief and the emptiest values the validator accepts elsewhere
 * (empty goal and acceptance, `tests: {hidden: [], command: ""}`, level behaviour, runner implementer/sonnet).
 * An existing spec keeps its scalar fields and every entry; only the lists are unioned and `sha` is updated. Returns the stored spec.
 */
export function planFromBrief(root, { briefFile, specId, sessionId, planDir }) {
  if (!briefFile) throw new Error("plan from-brief: <brief.yaml> is required");
  if (typeof specId !== "string" || !specId) throw new Error("plan from-brief: --spec <id> is required");
  const brief = loadYamlFile(briefFile, "brief");
  const sid = typeof sessionId === "string" && sessionId ? sessionId : specId.split(".")[0];
  const session = loadSession(planDir, sid);
  const existing = session.packages.find((p) => p.id === specId);
  const from = { edit: brief.edit ?? [], read: brief.read ?? [], callers: brief.callers ?? [], commands: brief.commands ?? [] };

  let spec;
  if (existing) {
    spec = { ...existing, sha: brief.sha, edit: union(existing.edit, from.edit, refKey) };
    if (from.read.length > 0 || existing.read) spec.read = union(existing.read, from.read, refKey);
    if (from.callers.length > 0 || existing.callers) spec.callers = union(existing.callers, from.callers, callerKey);
    if (from.commands.length > 0 || existing.commands) spec.commands = union(existing.commands, from.commands, (c) => c);
  } else {
    spec = {
      id: specId,
      plan: loadPlan(planDir).slug,
      goal: "",
      level: "behaviour",
      runner: { agent: "implementer", model: "sonnet" },
      sha: brief.sha,
      edit: from.edit,
      ...(from.read.length > 0 && { read: from.read }),
      ...(from.callers.length > 0 && { callers: from.callers }),
      ...(from.commands.length > 0 && { commands: from.commands }),
      acceptance: [],
      tests: { hidden: [], command: "" },
    };
  }
  const packages = existing ? session.packages.map((p) => (p === existing ? spec : p)) : [...session.packages, spec];
  saveSession(planDir, { ...session, packages });
  return spec;
}
