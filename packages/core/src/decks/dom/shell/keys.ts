// The shell's shared keys: undo and redo, zoom, tools, Space for the hand, slide paging, delete, deselect, duplicate, copy and paste, group and ungroup, Z for zoom to section.
import type { ShellKeyActions } from "./types.js";

const usesMeta = (): boolean => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const ignored = (event: KeyboardEvent): boolean => event.defaultPrevented
  || (event.target instanceof Element && event.target.closest("input, textarea, select, .cm-editor, [contenteditable]") !== null);

/** The action a key press maps to, or undefined when the key is not shared or its action is not given. */
function actionFor(event: KeyboardEvent, a: ShellKeyActions): (() => void) | undefined {
  const mod = usesMeta() ? event.metaKey : event.ctrlKey;
  const key = event.code === "Space" ? " " : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (mod) {
    if (key === "z") return event.shiftKey ? a.redo : a.undo;
    if (key === "y") return a.redo;
    if (key === "=" || key === "+") return a.zoomIn;
    if (key === "-") return a.zoomOut;
    if (key === "0") return a.fit;
    if (key === "d") return a.duplicate;
    if (key === "c" && !event.shiftKey) return a.copy;
    if (key === "v" && !event.shiftKey) return a.paste;
    if (key === "g") return event.shiftKey ? a.ungroup : a.group;
    return undefined;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  const { setTool } = a;
  switch (key) {
    case "v": return setTool && (() => setTool("select"));
    case "h": return setTool && (() => setTool("hand"));
    case " ": { const { holdHand } = a; return holdHand && (() => holdHand(true)); }
    case "PageDown": return a.next;
    case "PageUp": return a.previous;
    case "Delete": case "Backspace": return a.deleteSelection;
    case "Escape": return a.clearSelection;
    case "z": return a.zoomToSelection;
    default: return undefined;
  }
}

export function bindShellKeys(root: HTMLElement, actions: ShellKeyActions): () => void {
  const down = (event: KeyboardEvent): void => {
    if (ignored(event)) return;
    const run = actionFor(event, actions);
    if (!run) return;
    event.preventDefault();
    run.call(actions);
  };
  const up = (event: KeyboardEvent): void => {
    if ((event.key !== " " && event.code !== "Space") || !actions.holdHand || ignored(event)) return;
    event.preventDefault();
    actions.holdHand(false);
  };
  root.addEventListener("keydown", down);
  globalThis.addEventListener("keyup", up);
  return () => {
    root.removeEventListener("keydown", down);
    globalThis.removeEventListener("keyup", up);
  };
}
