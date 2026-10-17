// Says how many days are left until a project's deadline.
import type { ProjectTarget } from "../project/index.js";

export interface DeadlineText {
  text: string;
  tone: "normal" | "near" | "passed";
}

const DAY_MS = 86_400_000;
const NEAR_DAYS = 14;

/** Days are calendar days in the reader's time zone, so a deadline stays "0 d" until midnight. */
export function deadlineText(target: ProjectTarget | undefined, now: number): DeadlineText | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target?.deadline ?? "");
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const due = Date.UTC(year, month - 1, day);
  if (new Date(due).getUTCDate() !== day) return undefined;
  const today = new Date(now);
  // UTC arithmetic on both dates keeps daylight-saving shifts out of the difference.
  const days = Math.round((due - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / DAY_MS);
  if (days < 0) return { text: "passed", tone: "passed" };
  return { text: `${days} d`, tone: days <= NEAR_DAYS ? "near" : "normal" };
}
