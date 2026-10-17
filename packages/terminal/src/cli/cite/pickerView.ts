// Draws the picker: a prompt line, the matching papers with the selection highlighted, and a key hint.
import type { PaperRecord } from "@labshelf/core";

import { Screen } from "../../tui/index.js";
import { theme } from "../../ui/theme.js";
import { pickerMatches, type PickerState } from "./pickerState.js";

const HINT = "enter cite   esc cancel   up/down move";

function rowText(paper: PaperRecord): { key: string; rest: string } {
  const author = paper.authors?.[0];
  const detail = [author, paper.year].filter((part) => part !== undefined && part !== "").join(" ");
  return { key: paper.citeKey, rest: `${paper.title}${detail ? `  (${detail})` : ""}` };
}

/** @returns one frame of the picker for a terminal of the given size */
export function drawPicker(papers: readonly PaperRecord[], state: PickerState, width: number, height: number): Screen {
  const screen = new Screen(width, height);
  const matches = pickerMatches(papers, state);
  screen.text(0, 0, `Cite a paper (${matches.length} of ${papers.length})`, theme.title);
  screen.text(0, 1, "> ", theme.brand);
  screen.text(2, 1, state.query.value, theme.text, width - 2);
  const rows = Math.max(1, height - 3);
  const first = Math.min(Math.max(state.selected - rows + 1, 0), Math.max(matches.length - rows, 0));
  matches.slice(first, first + rows).forEach((paper, index) => {
    const y = 2 + index;
    const selected = first + index === state.selected;
    const { key, rest } = rowText(paper);
    if (selected) { screen.fill(0, y, width, 1, theme.hover); }
    const keyWidth = screen.text(0, y, key, selected ? theme.hover : theme.bold, width);
    screen.text(keyWidth + 2, y, rest, selected ? theme.hover : theme.text, Math.max(0, width - keyWidth - 2));
  });
  screen.text(0, height - 1, HINT, theme.dim, width);
  return screen;
}
