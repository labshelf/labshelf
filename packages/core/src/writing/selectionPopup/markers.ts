// The markup each formatting button of the selection popup wraps a selection in, per language.
import type { WrapMarkers } from "../snippets.js";
import type { TypingLanguage } from "../typing/helpers.js";
import type { SelectionPopupButtonId } from "./prefs.js";

const BRACES = ["{", "}"] as const;
const PARENS = ["(", ")"] as const;
const BRACKETS = ["[", "]"] as const;

const latex = (command: string): WrapMarkers => ({ open: `\\${command}{`, close: "}", pair: BRACES });
const typstCall = (name: string): WrapMarkers => ({ open: `${name}(`, close: ")", pair: PARENS });
const typstContent = (name: string): WrapMarkers => ({ open: `#${name}[`, close: "]", pair: BRACKETS });
const plain = (open: string, close = open): WrapMarkers => ({ open, close });

/** The markers of the buttons that wrap the selection; a button absent here does something else. */
export const SELECTION_POPUP_MARKERS: Readonly<Record<TypingLanguage, Partial<Record<SelectionPopupButtonId, WrapMarkers>>>> = {
  latex: {
    emphasis: latex("emph"), bold: latex("textbf"), math: plain("$"), code: latex("texttt"),
    mathBold: latex("mathbf"), mathUpright: latex("mathrm"), mathText: latex("text"),
    mathDelimiters: { open: "\\left(", close: "\\right)", pair: BRACES },
    underline: latex("underline"), footnote: latex("footnote"), quotes: { open: "``", close: "''", pair: BRACES }, smallCaps: latex("textsc"),
  },
  typst: {
    emphasis: plain("_"), bold: plain("*"), math: plain("$"), code: plain("`"),
    mathBold: typstCall("bold"), mathUpright: typstCall("upright"), mathText: plain("\""),
    mathDelimiters: { open: "lr((", close: "))", pair: PARENS },
    underline: typstContent("underline"), footnote: typstContent("footnote"), quotes: plain("\""), smallCaps: typstContent("smallcaps"),
  },
};
