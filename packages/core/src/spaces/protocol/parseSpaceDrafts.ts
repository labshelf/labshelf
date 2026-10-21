// Validates the date and term drafts inside Spaces page messages, keeping only the known fields.
import { isBoolean, isDay, isIdList, isNonEmptyString, isPage, isRecord, isString } from "../model/json/index.js";
import type { SpaceDateDraft, TermDraft } from "../store/index.js";

const isText = (value: unknown): value is string => isString(value) && value.trim() !== "";

export function parseDateDraft(raw: unknown): SpaceDateDraft | undefined {
  if (!isRecord(raw) || !isText(raw["title"]) || !isDay(raw["date"])) { return undefined; }
  const { kind, title, date, done, paperIds, projectId } = raw;
  switch (kind) {
    case "task": return isBoolean(done) ? { kind, title, date, done } : undefined;
    case "deadline": return { kind, title, date };
    case "read":
      if (paperIds === undefined) { return { kind, title, date }; }
      return isIdList(paperIds) ? { kind, title, date, paperIds } : undefined;
    case "project":
      if (projectId === undefined) { return { kind, title, date }; }
      return isNonEmptyString(projectId) ? { kind, title, date, projectId } : undefined;
    default: return undefined;
  }
}

function parseSource(raw: unknown): TermDraft["source"] | null {
  if (!isRecord(raw) || !isNonEmptyString(raw["paperId"])) { return null; }
  const { paperId, page } = raw;
  if (page === undefined) { return { paperId }; }
  return isPage(page) ? { paperId, page } : null;
}

export function parseTermDraft(raw: unknown): TermDraft | undefined {
  if (!isRecord(raw) || !isText(raw["term"]) || !isString(raw["definition"])) { return undefined; }
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
