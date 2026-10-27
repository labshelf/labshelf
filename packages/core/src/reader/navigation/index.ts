/** Exports the pure navigation logic: key resolution, zoom and find-scroll maths, view history, action dedupe and the outline model. */
export * from "./navigation.js";
export {
  ACTIONS_BLOCKED_WHILE_TYPING, CHORD_TIMEOUT_MS, deriveCheatsheetRows, resolveShortcut,
  type CheatsheetRow, type ReaderAction, type ShortcutContext, type ShortcutInput, type ShortcutResolution,
} from "./keymap.js";
export * from "./outline.js";
