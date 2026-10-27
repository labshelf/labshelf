// Validates the date and term drafts inside Spaces page messages, keeping only the known fields.
import { isPage } from "../model/json/index.js";
import { isBoolean, isNonBlankString, isNonEmptyString, isNonEmptyStringList, isRecord, isString } from "../../guards/index.js";
import { isCalendarDay } from "../../time/index.js";
import type { SpaceDateInput, TermInput } from "../store/index.js";

export function parseDateDraft(raw: unknown): SpaceDateInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["title"]) || !isCalendarDay(raw["date"])) { return undefined; }
  const { kind, title, date, done, paperIds, projectId } = raw;
  switch (kind) {
    case "task": return isBoolean(done) ? { kind, title, date, done } : undefined;
    case "deadline": return { kind, title, date };
    case "read":
      if (paperIds === undefined) { return { kind, title, date }; }
      return isNonEmptyStringList(paperIds) ? { kind, title, date, paperIds } : undefined;
    case "project":
      if (projectId === undefined) { return { kind, title, date }; }
      return isNonEmptyString(projectId) ? { kind, title, date, projectId } : undefined;
    default: return undefined;
  }
}

function parseSource(raw: unknown): TermInput["source"] | null {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"])) { return null; }
  const { paperId, page } = raw;
  if (page === undefined) { return { paperId }; }
  return isPage(page) ? { paperId, page } : null;
}

export function parseTermDraft(raw: unknown): TermInput | undefined {
  if (!isRecord(raw) || !isNonBlankString(raw["term"]) || !isString(raw["definition"])) { return undefined; }
  const { term, definition, symbol, source } = raw;
  if (symbol !== undefined && !isString(symbol)) { return undefined; }
  const parsedSource = source === undefined ? undefined : parseSource(source);
  if (parsedSource === null) { return undefined; }
  return {
    term, definition,
    ...(symbol === undefined ? {} : { symbol }),
    ...(parsedSource === undefined ? {} : { source: parsedSource }),
  };
}
