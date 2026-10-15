/**
 * Maps a key press to a list action as a pure function, so every host gets the same keys.
 */
import type { PaperStatus } from "../model/index.js";

/** The parts of a keyboard event the keymap reads. */
export interface KeyPress {
  key: string;
  /** Physical key, so Alt+digit works on layouts where Alt changes the character. */
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type ListKeyAction =
  | { kind: "focusSearch" }
  | { kind: "step"; delta: 1 | -1; extend: boolean }
  | { kind: "edge"; to: "first" | "last" }
  | { kind: "parent" }
  | { kind: "open" }
  | { kind: "escape" }
  | { kind: "selectAll" }
  | { kind: "setStatus"; status: PaperStatus }
  | { kind: "remove" }
  | { kind: "copyKeys" }
  | { kind: "menu" }
  | { kind: "typeToSearch" };

const STATUS_BY_CODE: Record<string, PaperStatus> = { Digit1: "unread", Digit2: "reading", Digit3: "done" };

function modifiedAction(k: KeyPress, mod: boolean): ListKeyAction | null {
  if (mod && k.key.toLowerCase() === "f") return { kind: "focusSearch" };
  if (mod && k.key.toLowerCase() === "a") return { kind: "selectAll" };
  if (mod && k.key.toLowerCase() === "c") return { kind: "copyKeys" };
  if (mod && k.key === "Backspace") return { kind: "remove" };
  const status = STATUS_BY_CODE[k.code];
  if (k.alt && !mod && status) return { kind: "setStatus", status };
  if (k.alt && k.key === "ArrowUp") return { kind: "parent" };
  if (k.key === "ContextMenu" || (k.shift && k.key === "F10")) return { kind: "menu" };
  return null;
}

/** The action a key press triggers in the list, or null when the list leaves the key alone. */
export function listKeyAction(k: KeyPress): ListKeyAction | null {
  const mod = k.meta || k.ctrl;
  const modified = modifiedAction(k, mod);
  if (modified) return modified;
  switch (k.key) {
    case "/": return { kind: "focusSearch" };
    case "ArrowDown": return { kind: "step", delta: 1, extend: k.shift };
    case "ArrowUp": return { kind: "step", delta: -1, extend: k.shift };
    case "Home": return { kind: "edge", to: "first" };
    case "End": return { kind: "edge", to: "last" };
    case "Enter": return { kind: "open" };
    case "Escape": return { kind: "escape" };
    case "Delete": return { kind: "remove" };
  }
  return k.key.length === 1 && !mod && !k.alt ? { kind: "typeToSearch" } : null;
}
