// Names the source editor's selection popup buttons and keeps the settings every text bubble shares (the source editor's popup, the notes' bubble): when it opens on a selection, whether a click opens it, whether it suggests actions, and which buttons are hidden.
// CONTRACT: documents/contracts/library-format.md#editor-preferences-editor-prefsjson
import type { TypingLanguage } from "../typing/helpers.js";

export const SELECTION_POPUP_TRIGGERS = ["mouse", "any", "never"] as const;
/** On a selection, mouse: after a drag selection; any: also double clicks and keyboard selections; never: only with Mod-., which always opens the bubble. */
export type SelectionPopupTrigger = (typeof SELECTION_POPUP_TRIGGERS)[number];

export interface SelectionPopupPrefs {
  trigger: SelectionPopupTrigger;
  /** A plain click opens the bubble: insertions at the cursor, or the actions of the citation, reference or drawing clicked. */
  onClick: boolean;
  /** The actions that depend on what is selected show. */
  contextual: boolean;
  /** Ids of the buttons the user hid; unknown ids are kept. */
  hidden: readonly string[];
}

export const DEFAULT_SELECTION_POPUP: SelectionPopupPrefs = Object.freeze({ trigger: "mouse", onClick: true, contextual: true, hidden: Object.freeze([]) as readonly string[] });
export const DEFAULT_NOTE_POPUP: SelectionPopupPrefs = Object.freeze({ trigger: "any", onClick: true, contextual: true, hidden: Object.freeze([]) as readonly string[] });

/** The keys of editor-prefs.json that hold a bubble's settings, and the defaults of each. */
export const EDITOR_POPUP_DEFAULTS = { selectionPopup: DEFAULT_SELECTION_POPUP, notePopup: DEFAULT_NOTE_POPUP } as const;
export type EditorPopupKey = keyof typeof EDITOR_POPUP_DEFAULTS;

/** The selection buttons the user can hide one by one, by group; contextual actions follow the `contextual` switch instead, and the insert buttons are in inserts.ts. */
export const SELECTION_POPUP_BUTTONS = {
  fixed: ["comment", "viewInPdf"],
  formatting: ["emphasis", "bold", "math", "code", "mathBold", "mathUpright", "mathText", "mathDelimiters"],
  overflow: ["underline", "footnote", "quotes", "smallCaps", "cite"],
} as const;

export type SelectionPopupButtonId = (typeof SELECTION_POPUP_BUTTONS)[keyof typeof SELECTION_POPUP_BUTTONS][number];

export interface SelectionPopupButtonInfo {
  label: string;
  /** The languages the button shows in; both when absent. */
  languages?: readonly TypingLanguage[];
}

export const SELECTION_POPUP_BUTTON_INFO: Readonly<Record<SelectionPopupButtonId, SelectionPopupButtonInfo>> = {
  comment: { label: "Comment" },
  viewInPdf: { label: "View in PDF", languages: ["latex"] },
  emphasis: { label: "Emphasis" },
  bold: { label: "Bold" },
  math: { label: "Math" },
  code: { label: "Code" },
  mathBold: { label: "Bold (math)" },
  mathUpright: { label: "Upright (math)" },
  mathText: { label: "Text (math)" },
  mathDelimiters: { label: "Sized parentheses (math)" },
  underline: { label: "Underline" },
  footnote: { label: "Footnote" },
  quotes: { label: "Quotes" },
  smallCaps: { label: "Small caps" },
  cite: { label: "Cite…" },
};

/** The hideable buttons of `language`, in the dialog's order. */
export function listSelectionPopupButtons(language: TypingLanguage): SelectionPopupButtonId[] {
  return Object.values(SELECTION_POPUP_BUTTONS).flat().filter((id) => SELECTION_POPUP_BUTTON_INFO[id].languages?.includes(language) ?? true);
}

const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The stored trigger; "shortcut", from the version where Mod-. alone could open it, reads as "never". */
const readTrigger = (value: unknown): SelectionPopupTrigger | undefined =>
  value === "shortcut" ? "never" : (SELECTION_POPUP_TRIGGERS as readonly unknown[]).includes(value) ? value as SelectionPopupTrigger : undefined;

/** Defensive parse against the key's `defaults`: anything missing or of the wrong type takes its default; ids in `hidden` are kept whether known or not. */
export function parseSelectionPopupPrefs(value: unknown, defaults: SelectionPopupPrefs = DEFAULT_SELECTION_POPUP): SelectionPopupPrefs {
  if (!isRecordValue(value)) return defaults;
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((id): id is string => typeof id === "string"))] : [];
  return {
    trigger: readTrigger(value.trigger) ?? defaults.trigger,
    onClick: typeof value.onClick === "boolean" ? value.onClick : defaults.onClick,
    contextual: typeof value.contextual === "boolean" ? value.contextual : defaults.contextual,
    hidden,
  };
}

/** Strict parse for messages: the value with every key of the right type, or undefined. */
export function parseSelectionPopupMessage(value: unknown): SelectionPopupPrefs | undefined {
  const trigger = isRecordValue(value) ? readTrigger(value.trigger) : undefined;
  if (!isRecordValue(value) || !trigger) return undefined;
  if (typeof value.onClick !== "boolean" || typeof value.contextual !== "boolean") return undefined;
  if (!Array.isArray(value.hidden) || !value.hidden.every((id) => typeof id === "string")) return undefined;
  return { trigger, onClick: value.onClick, contextual: value.contextual, hidden: [...value.hidden as string[]] };
}

/** Whether two settings are the same, `hidden` compared as a set. */
export function isSameSelectionPopup(a: SelectionPopupPrefs, b: SelectionPopupPrefs): boolean {
  return a.trigger === b.trigger && a.onClick === b.onClick && a.contextual === b.contextual
    && a.hidden.length === b.hidden.length && a.hidden.every((id) => b.hidden.includes(id));
}

/** The settings as the file stores them: `hidden` sorted. */
export function formatSelectionPopupPrefs(prefs: SelectionPopupPrefs): Record<string, unknown> {
  return { contextual: prefs.contextual, hidden: [...new Set(prefs.hidden)].sort(), onClick: prefs.onClick, trigger: prefs.trigger };
}
