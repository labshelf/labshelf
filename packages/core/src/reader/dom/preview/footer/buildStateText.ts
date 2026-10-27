// Chooses what the preview footer's status says from the build state and the build roots.
import { formatCompactTime } from "../../../../library/paper/index.js";
import type { BuildState, PreviewBuildRoot, PreviewBuildRoots } from "../../../index.js";
import { deriveFileName } from "../deriveFileName.js";

export interface PreviewBuildState {
  state: BuildState;
  errors: number;
  /** The source changed after this build. */
  stale?: boolean;
  /** When the build finished, in epoch milliseconds. */
  builtAt?: number;
}

export interface BuildStateText {
  text: string;
  tone: "busy" | "error" | "warning" | "";
  /** The root whose logs a click opens; absent when the status is plain text. */
  logsRoot?: string;
  /** The text ages, so it needs a periodic refresh. */
  timed?: boolean;
}

const errorCount = (root: PreviewBuildRoot): number => root.problems.filter((p) => p.severity === "error").length;
/** Sentence text for the build's age: "just now", "2 min ago", "3 h ago". */
function age(builtAt: number, now: number): string {
  const elapsed = formatCompactTime(builtAt, now);
  return elapsed === "now" ? "just now" : `${elapsed} ago`;
}
const count = (n: number): string => `${n} ${n === 1 ? "error" : "errors"}`;

function failure(label: string, errors: number, separator: string, logsRoot?: string): BuildStateText {
  const text = errors > 0 ? `${label}${separator}${count(errors)}` : label;
  return { text, tone: "error", ...(logsRoot === undefined ? {} : { logsRoot }) };
}

/** Precedence: building, then the shown root's failure, the focused root's, stale source, and the build's age. */
export function formatBuildStateText(roots: PreviewBuildRoots | null, build: PreviewBuildState, now: number): BuildStateText {
  if (build.state === "building") { return { text: "Compiling…", tone: "busy" }; }
  // Before the roots arrive the build message alone says whether the shown document failed.
  if (!roots) { return build.state === "failed" ? failure("Build failed", build.errors, " · ") : { text: "", tone: "" }; }
  const shown = roots.roots.find((r) => r.path === roots.shown);
  if (shown?.failed) { return failure("Build failed", errorCount(shown), " · ", shown.path); }
  const focused = roots.focused === roots.shown ? undefined : roots.roots.find((r) => r.path === roots.focused);
  if (focused?.failed) { return failure(deriveFileName(focused.path), errorCount(focused), ": ", focused.path); }
  if (build.stale) { return { text: "Source changed", tone: "warning" }; }
  if (build.builtAt !== undefined) {
    return { text: `Compiled ${age(build.builtAt, now)}`, tone: "", timed: true };
  }
  return { text: "", tone: "" };
}
