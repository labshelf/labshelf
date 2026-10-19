// Lists every match of a pattern across file texts, optionally in one file only.
import type { MatchLocation } from "./protocol/index.js";
import { findInText } from "./findInText.js";
import type { ProjectText } from "./searchRun.js";

export function matchesIn(texts: readonly ProjectText[], pattern: RegExp, onlyPath?: string): MatchLocation[] {
  return texts
    .filter(({ path }) => onlyPath === undefined || path === onlyPath)
    .flatMap(({ path, text }) => findInText(text, pattern).map(({ line, column, length }) => ({ path, line, column, length })));
}
