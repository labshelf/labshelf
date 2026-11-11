// The insertions a plain click offers in the source editor's bubble, per language and per what the click lands on (see deriveInsertContext).
import type { IconName } from "../../ui/icons/index.js";
import type { TypingLanguage } from "../typing/helpers.js";
import type { InsertContext } from "./context.js";

/** Host actions an insertion runs; each is offered only when the host gives it. */
export type InsertHostAction = "cite" | "figure" | "table" | "image" | "symbol";

/**
 * snippet: a TextMate-style template (`$1`, `${1:env}`, `$0`) inserted at the cursor, then the editor's completion when `complete` is set;
 * host: one of the host's actions; item and row: a new list item or table row after the cursor's line.
 */
export type InsertRun =
  | { kind: "snippet"; template: string; complete?: boolean }
  | { kind: "host"; action: InsertHostAction }
  | { kind: "item" }
  | { kind: "row" };

export interface InsertDefinition {
  /** The id the settings hide it by. */
  id: string;
  label: string;
  icon: IconName;
  contexts: readonly InsertContext[];
  run: InsertRun;
}

const snippet = (template: string, complete?: boolean): InsertRun => ({ kind: "snippet", template, ...(complete && { complete }) });
const host = (action: InsertHostAction): InsertRun => ({ kind: "host", action });

const LATEX: readonly InsertDefinition[] = [
  { id: "insertMath", label: "Inline math", icon: "sigma", contexts: ["inline"], run: snippet("$$1$") },
  { id: "insertCite", label: "Cite…", icon: "quote", contexts: ["inline"], run: host("cite") },
  { id: "insertReference", label: "Reference", icon: "link", contexts: ["inline"], run: snippet("\\ref{$1}", true) },
  { id: "insertFootnote", label: "Footnote", icon: "superscript", contexts: ["inline"], run: snippet("\\footnote{$1}") },
  { id: "insertSection", label: "Section", icon: "heading", contexts: ["blankLine"], run: snippet("\\section{$1}") },
  { id: "insertDisplayMath", label: "Display math", icon: "sigma-block", contexts: ["blankLine"], run: snippet("\\begin{equation}\n\t$1\n\\end{equation}") },
  { id: "insertList", label: "List", icon: "list", contexts: ["blankLine"], run: snippet("\\begin{itemize}\n\t\\item $1\n\\end{itemize}") },
  { id: "insertFigure", label: "Figure", icon: "draw-pencil", contexts: ["blankLine"], run: host("figure") },
  { id: "insertTable", label: "Table", icon: "table", contexts: ["blankLine"], run: host("table") },
  { id: "insertImage", label: "Image", icon: "file-media", contexts: ["blankLine"], run: host("image") },
  { id: "insertEnvironment", label: "Environment…", icon: "box", contexts: ["blankLine"], run: snippet("\\begin{${1:env}}\n\t$0\n\\end{$1}") },
  { id: "insertFraction", label: "Fraction", icon: "function-square", contexts: ["math"], run: snippet("\\frac{$1}{$2}") },
  { id: "insertSum", label: "Sum", icon: "sigma", contexts: ["math"], run: snippet("\\sum_{$1}^{$2}") },
  { id: "insertIntegral", label: "Integral", icon: "sine", contexts: ["math"], run: snippet("\\int_{$1}^{$2}") },
  { id: "insertText", label: "Text", icon: "text-box", contexts: ["math"], run: snippet("\\text{$1}") },
  { id: "insertSymbol", label: "Symbol", icon: "symbol-operator", contexts: ["blankLine", "math"], run: host("symbol") },
  { id: "insertItem", label: "New item", icon: "plus", contexts: ["list"], run: { kind: "item" } },
  { id: "insertRow", label: "New row", icon: "plus", contexts: ["table"], run: { kind: "row" } },
];

const TYPST: readonly InsertDefinition[] = [
  { id: "insertMath", label: "Inline math", icon: "sigma", contexts: ["inline"], run: snippet("$$1$") },
  { id: "insertCite", label: "Cite…", icon: "quote", contexts: ["inline"], run: host("cite") },
  { id: "insertReference", label: "Reference", icon: "link", contexts: ["inline"], run: snippet("@", true) },
  { id: "insertFootnote", label: "Footnote", icon: "superscript", contexts: ["inline"], run: snippet("#footnote[$1]") },
  { id: "insertSection", label: "Heading", icon: "heading", contexts: ["blankLine"], run: snippet("= $1") },
  { id: "insertDisplayMath", label: "Display math", icon: "sigma-block", contexts: ["blankLine"], run: snippet("$ $1 $") },
  { id: "insertList", label: "List", icon: "list", contexts: ["blankLine"], run: snippet("- $1") },
  { id: "insertFigure", label: "Figure", icon: "draw-pencil", contexts: ["blankLine"], run: host("figure") },
  { id: "insertTable", label: "Table", icon: "table", contexts: ["blankLine"], run: host("table") },
  { id: "insertImage", label: "Image", icon: "file-media", contexts: ["blankLine"], run: host("image") },
  { id: "insertFraction", label: "Fraction", icon: "function-square", contexts: ["math"], run: snippet("frac($1, $2)") },
  { id: "insertSum", label: "Sum", icon: "sigma", contexts: ["math"], run: snippet("sum_($1)^($2)") },
  { id: "insertIntegral", label: "Integral", icon: "sine", contexts: ["math"], run: snippet("integral_($1)^($2)") },
  { id: "insertText", label: "Text", icon: "text-box", contexts: ["math"], run: snippet("\"$1\"") },
  { id: "insertSymbol", label: "Symbol", icon: "symbol-operator", contexts: ["blankLine", "math"], run: host("symbol") },
  { id: "insertItem", label: "New item", icon: "plus", contexts: ["list"], run: { kind: "item" } },
];

/** Every insertion of each language, in the bubble's and the settings dialog's order. */
export const SELECTION_POPUP_INSERTS: Readonly<Record<TypingLanguage, readonly InsertDefinition[]>> = { latex: LATEX, typst: TYPST };
