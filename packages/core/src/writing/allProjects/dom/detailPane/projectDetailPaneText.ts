// Writes the sentences of the All projects detail pane: meta line, venue line, limit sentence and build status.
import { formatCompactTime } from "../../../../library/index.js";
import type { ProjectTarget } from "../../../project/index.js";
import { countDaysUntil } from "../../formatDeadlineText.js";
import type { CountedLimit, ProjectPaneContent } from "../../projectDetailPane.js";
import type { ProjectBuildState, ProjectRow } from "../../projectRow.js";

const FORMAT_NAME = { latex: "LaTeX", typst: "Typst" } as const;
const BUILD_STATUS: Record<ProjectBuildState, string> = {
  ok: "Built", warnings: "Built, with warnings", failed: "Build failed", building: "Building", earlier: "Built", never: "Never built",
};

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "LaTeX · main.tex · 8 pages · modified 2 h ago", with only the parts the row and the detail know. */
export function formatMetaLine(row: ProjectRow, pages: number | undefined, now: number): string {
  const modified = row.modified === undefined ? undefined : formatCompactTime(row.modified, now);
  return [
    row.format && FORMAT_NAME[row.format],
    row.main,
    pages !== undefined && plural(pages, "page"),
    modified && (modified === "now" ? "modified just now" : `modified ${modified} ago`),
  ].filter(Boolean).join(" · ");
}

/** "ICLR 2027 · due in 41 days"; the venue or the deadline alone when the other is unset. */
export function formatProjectVenueLine(target: ProjectTarget | undefined, now: number): string | undefined {
  const days = countDaysUntil(target, now);
  const due = days === undefined ? undefined : days < 0 ? "deadline passed" : days === 0 ? "due today" : `due in ${plural(days, "day")}`;
  const line = [target?.venue, due].filter(Boolean).join(" · ");
  return line || undefined;
}

function withLimit(c: CountedLimit | undefined, noun: string): { counted: number; limit: number; noun: string } | undefined {
  return c?.limit === undefined ? undefined : { counted: c.counted, limit: c.limit, noun };
}

/** "1 page left · counted up to the references"; a page limit wins over a word limit, and no limit gives no sentence. */
export function describeLimits(limits: ProjectPaneContent["limits"]): string | undefined {
  const counted = withLimit(limits.pages, "page") ?? withLimit(limits.words, "word");
  if (!counted) return undefined;
  const left = counted.limit - counted.counted;
  const head = left > 0 ? `${plural(left, counted.noun)} left` : left === 0 ? "At the limit" : `${plural(-left, counted.noun)} over`;
  return `${head} · counted ${limits.countUpTo === "references" ? "up to the references" : "to the end"}`;
}

/** "2 warnings" when the count is known, else the state's name; no mark reads as never built. */
export function formatProjectBuildStateText(build: { state: ProjectBuildState; warnings?: number } | undefined): string {
  if (!build) return BUILD_STATUS.never;
  if (build.state === "warnings" && build.warnings !== undefined) return plural(build.warnings, "warning");
  return BUILD_STATUS[build.state];
}
