// Per-gesture undo and redo for the drawing editor (decision D6): an immutable stack of editor states; the host pushes one state per completed gesture.
import type { EditorState } from "./state.js";

export interface EditorHistory { state: import("./state.js").EditorState; undo(): EditorHistory; redo(): EditorHistory; push(next: import("./state.js").EditorState): EditorHistory }

function makeHistory(past: readonly EditorState[], state: EditorState, future: readonly EditorState[]): EditorHistory {
  return {
    state,
    undo(): EditorHistory {
      const previous = past[past.length - 1];
      return previous === undefined ? this : makeHistory(past.slice(0, -1), previous, [state, ...future]);
    },
    redo(): EditorHistory {
      const [next, ...rest] = future;
      return next === undefined ? this : makeHistory([...past, state], next, rest);
    },
    push(next: EditorState): EditorHistory {
      return makeHistory([...past, state], next, []);
    },
  };
}

/** A history whose current state is `state`, with nothing to undo or redo. */
export function createHistory(state: import("./state.js").EditorState): EditorHistory {
  return makeHistory([], state, []);
}
