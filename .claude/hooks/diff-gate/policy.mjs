// Policy variants: map annotated violations (see annotate.mjs) to "block" | "autofix" | "notify" | "silent".
// "notify" (variant f only) never blocks: the hook shows it to the user with systemMessage and keeps it out of the model's context.
// Pure: no I/O, so a replay script can apply any variant to saved gate JSON without rerunning the tools.
export const VARIANTS = ["a", "b", "c", "d", "f"];
export const DEFAULT_VARIANT = "f";
const D_BLOCKING_RULES = new Set(["eslint-disable", "ts-ignore", "test-skip"]);

export function normalizeVariant(value) {
  const variant = String(value ?? DEFAULT_VARIANT).trim().toLowerCase();
  return VARIANTS.includes(variant) ? variant : DEFAULT_VARIANT;
}

// Action for one violation under one variant. `ctx.subagent` is true on SubagentStop (variant f blocks forbidden edits only there).
export function decide(violation, variant = DEFAULT_VARIANT, ctx = {}) {
  const v = normalizeVariant(variant);
  const note = violation.annotation ?? {};
  if (v === "f") return decideF(violation, note, ctx);
  switch (violation.kind) {
    case "unused-file":
      if (v === "a") return "block";
      if (v === "d") return "silent";
      return (note.configRefs ?? 0) > 0 ? "silent" : "block";
    case "unused-export": {
      const localRefs = note.localRefs ?? 0;
      if (v === "a" || v === "b") return "block";
      if (v === "c") return localRefs > 0 ? "autofix" : "block";
      return localRefs > 0 ? "autofix" : "silent";
    }
    case "source-rule": {
      const cls = note.ruleClass ?? "other";
      if (v === "a") return "block";
      if (cls === "other") return "silent";
      if (v === "d") return D_BLOCKING_RULES.has(cls) ? "block" : "silent";
      return "block";
    }
    default:
      // clone, forbidden-path, forbidden-script, and anything unknown
      return "block";
  }
}

// Variant f: block clones and added lint suppressions (and forbidden edits on SubagentStop), autofix local-use exports, notify the rest.
function decideF(violation, note, ctx) {
  switch (violation.kind) {
    case "unused-export":
      return (note.localRefs ?? 0) > 0 ? "autofix" : "notify";
    case "source-rule":
      return D_BLOCKING_RULES.has(note.ruleClass ?? "other") ? "block" : "notify";
    case "clone":
      return "block";
    case "forbidden-path":
    case "forbidden-script":
      return ctx.subagent ? "block" : "notify";
    default:
      return "notify";
  }
}

// Splits a violation list into { block, autofix, notify, silent } arrays (input order kept).
export function applyPolicy(violations, variant = DEFAULT_VARIANT, ctx = {}) {
  const out = { block: [], autofix: [], notify: [], silent: [] };
  for (const violation of violations) out[decide(violation, variant, ctx)].push(violation);
  return out;
}
