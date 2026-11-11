// Names the source editor's selection popup buttons and keeps its settings: when it opens, whether a click on a token opens it, whether it suggests actions, and which buttons are hidden.
// CONTRACT: documents/contracts/library-format.md#editor-preferences-editor-prefsjson
import type { TypingLanguage } from "../typing/helpers.js";

export const SELECTION_POPUP_TRIGGERS = ["mouse", "any", "shortcut", "never"] as const;
/** mouse: after a drag selection; any: also double clicks and keyboard selections; shortcut: only Mod-.; never: not even Mod-. */
export type SelectionPopupTrigger = (typeof SELECTION_POPUP_TRIGGERS)[number];

export interface SelectionPopupPrefs {
  trigger: SelectionPopupTrigger;
  /** A plain click on a citation key, a reference or a drawing block opens the popup on that token. */
  onClick: boolean;
  /** The actions that depend on what is selected show. */
  contextual: boolean;
  /** Ids of the buttons the user hid; unknown ids are kept. */
  hidden: readonly string[];
}

export const DEFAULT_SELECTION_POPUP: SelectionPopupPrefs = Object.freeze({ trigger: "mouse", onClick: false, contextual: true, hidden: Object.freeze([]) as readonly string[] });

/** The buttons the user can hide one by one, by group; contextual actions follow the `contextual` switch instead. */
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

/** Defensive parse: anything missing or of the wrong type takes its default; ids in `hidden` are kept whether known or not. */
export function parseSelectionPopupPrefs(value: unknown): SelectionPopupPrefs {
  if (!isRecordValue(value)) return DEFAULT_SELECTION_POPUP;
  const trigger = (SELECTION_POPUP_TRIGGERS as readonly unknown[]).includes(value.trigger) ? value.trigger as SelectionPopupTrigger : DEFAULT_SELECTION_POPUP.trigger;
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter((id): id is string => typeof id === "string"))] : [];
  return {
    trigger,
    onClick: typeof value.onClick === "boolean" ? value.onClick : DEFAULT_SELECTION_POPUP.onClick,
    contextual: typeof value.contextual === "boolean" ? value.contextual : DEFAULT_SELECTION_POPUP.contextual,
    hidden,
  };
}

/** Strict parse for messages: the value with every key of the right type, or undefined. */
export function parseSelectionPopupMessage(value: unknown): SelectionPopupPrefs | undefined {
  if (!isRecordValue(value) || !(SELECTION_POPUP_TRIGGERS as readonly unknown[]).includes(value.trigger)) return undefined;
  if (typeof value.onClick !== "boolean" || typeof value.contextual !== "boolean") return undefined;
  if (!Array.isArray(value.hidden) || !value.hidden.every((id) => typeof id === "string")) return undefined;
  return { trigger: value.trigger as SelectionPopupTrigger, onClick: value.onClick, contextual: value.contextual, hidden: [...value.hidden as string[]] };
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
