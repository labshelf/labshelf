// Holds the picker's pure state: the query, the selection and how a key press changes them.
import type { PaperRecord } from "@labshelf/core";
import { rankFuzzy } from "@labshelf/core";

import type { InputEvent } from "../../tui/index.js";
import { editText, textInput, type TextInputState } from "../../ui/index.js";

export interface PickerState {
  query: TextInputState;
  /** Index into the matches. */
  selected: number;
}

export type PickerStep = { kind: "state"; state: PickerState } | { kind: "pick"; paper: PaperRecord } | { kind: "cancel" };

export const initialPicker = (): PickerState => ({ query: textInput(), selected: 0 });

const label = (paper: PaperRecord): string =>
  [paper.citeKey, paper.title, ...(paper.authors ?? []), paper.year ?? ""].join(" ");

/** @returns the papers matching the query, best first */
export function pickerMatches(papers: readonly PaperRecord[], state: PickerState): PaperRecord[] {
  return rankFuzzy(papers, state.query.value, label);
}

function moved(state: PickerState, by: number, count: number): PickerStep {
  return { kind: "state", state: { ...state, selected: Math.min(Math.max(state.selected + by, 0), Math.max(count - 1, 0)) } };
}

/**
 * Applies one input event.
 * @returns the next state, the picked paper, or a cancel
 */
export function stepPicker(papers: readonly PaperRecord[], state: PickerState, event: InputEvent): PickerStep {
  const matches = pickerMatches(papers, state);
  if (event.type === "key") {
    switch (event.id) {
      case "enter": {
        const paper = matches[state.selected];
        return paper ? { kind: "pick", paper } : { kind: "state", state };
      }
      case "esc": case "C-c": case "C-g": return { kind: "cancel" };
      case "up": case "C-p": return moved(state, -1, matches.length);
      case "down": case "C-n": return moved(state, 1, matches.length);
      case "pageup": return moved(state, -10, matches.length);
      case "pagedown": return moved(state, 10, matches.length);
      default: break;
    }
  }
  const query = editText(state.query, event);
  return { kind: "state", state: query ? { query, selected: 0 } : state };
}
