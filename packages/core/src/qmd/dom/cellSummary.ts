// The one summary line of a collapsed code cell (plan D8): '<Language> · <kind> · ran <when>', read from the cell, its output nodes and a clock.
import type { Node as ProseNode } from "prosemirror-model";
import { cellLanguageLabel } from "../compute/index.js";
import { parseDivOpener, readAttribute, readOutputImage, readOutputPlot } from "../item/index.js";
import { fenceCellLanguage } from "./inlineViews.js";
import { outputContent } from "./outputView.js";

/** What a collapsed cell's summary says about its result. The out-of-date states depend on the editor (code hash, cells above) and are set by the view. */
export type CellSummaryState = "ok" | "error" | "out-of-date" | "maybe-out-of-date" | "none";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The language as the language picker shows it, or the fence language as written. */
export function cellLanguageName(lang: string | null): string {
  const language = fenceCellLanguage(lang);
  return language ? cellLanguageLabel(language) : lang ?? "";
}

/** Whether an output block's opening line says `status="error"`. */
export function isErrorOutput(raw: string): boolean {
  const opener = parseDivOpener(raw.split(/\r\n|\n|\r/, 1)[0] ?? "");
  return opener !== undefined && readAttribute(opener, "status") === "error";
}

/** The kind word of a non-error result: 2D plot, 3D plot, image, LaTeX or text. */
function kindOf(content: string): string {
  const plot = readOutputPlot(content);
  if (plot) return plot.spec.dim === 3 ? "3D plot" : "2D plot";
  if (readOutputImage(content)) return "image";
  if (/^\s*\$\$[\s\S]*?\$\$\s*$/.test(content)) return "LaTeX";
  return "text";
}

const dayStart = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** 'just now', 'N min ago', 'N h ago' (same day), 'yesterday', else the day and month (and the year when it is not this year), in local time. */
function formatWhen(ran: number, now: Date): string {
  const ago = now.getTime() - ran;
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  const then = new Date(ran);
  const today = dayStart(now);
  if (dayStart(then) === today) return `${Math.floor(ago / HOUR)} h ago`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (dayStart(then) === yesterday) return "yesterday";
  const date = `${then.getDate()} ${MONTHS[then.getMonth()]!}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date} ${then.getFullYear()}`;
}

/**
 * The summary of a collapsed `cell` with its `outputs` (the output nodes after it), at `now`. An error output makes the kind 'error' and the state 'error',
 * so an error is never summarised as ok; without outputs the cell has 'no output' and was 'not run'. Returns only 'ok', 'error' or 'none'.
 */
export function cellSummary(cell: ProseNode, outputs: readonly ProseNode[], now: Date): { text: string; state: CellSummaryState } {
  const language = cellLanguageName(cell.attrs.lang as string | null);
  if (outputs.length === 0) return { text: `${language} · no output · not run`, state: "none" };
  const raws = outputs.map((output) => output.attrs.raw as string);
  const error = raws.some(isErrorOutput);
  const content = raws.map(outputContent).find((text) => text.trim() !== "");
  const kind = error ? "error" : content === undefined ? "no output" : kindOf(content);
  const times = outputs.map((output) => Date.parse((output.attrs.ran as string | null) ?? "")).filter((time) => !Number.isNaN(time));
  const parts = [language, kind];
  if (times.length > 0) parts.push(`ran ${formatWhen(Math.max(...times), now)}`);
  return { text: parts.join(" · "), state: error ? "error" : "ok" };
}
