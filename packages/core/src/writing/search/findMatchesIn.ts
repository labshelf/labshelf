// Lists every match of a pattern across file texts, optionally in one file only.
import type { MatchPosition } from "./protocol/index.js";
import { findInText } from "./findInText.js";
import type { ProjectText } from "./searchRun.js";

export function findMatchesIn(texts: readonly ProjectText[], pattern: RegExp, onlyPath?: string): MatchPosition[] {
  return texts
    .filter(({ path }) => onlyPath === undefined || path === onlyPath)
    .flatMap(({ path, text }) => findInText(text, pattern).map(({ line, column, length }) => ({ path, line, column, length })));
}
