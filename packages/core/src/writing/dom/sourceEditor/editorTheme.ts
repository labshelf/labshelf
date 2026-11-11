// The source editor's look: the CodeMirror theme on the --ls- tokens, the comment and lint marks, and the syntax colours of LaTeX and Typst.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--ls-fg)", backgroundColor: "var(--ls-bg)", fontSize: "var(--ls-font-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ls-code-font)" },
  ".cm-content": { caretColor: "var(--ls-editor-cursor)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ls-editor-cursor)", borderLeftWidth: "var(--ls-editor-cursor-width)" },
  // As in VS Code, no rule parts the gutters from the text, and the numbers sit close to it.
  ".cm-gutters": { backgroundColor: "var(--ls-bg)", color: "var(--ls-section-fg)", border: "none" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--ls-space-1) 0 var(--ls-space-4)" },
  ".cm-activeLineGutter": { color: "var(--ls-fg)" },
  // TRAP: The active line sits above the selection layer, so its background must be translucent.
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--ls-row-open)" },
  ".cm-selectionBackground": { backgroundColor: "var(--ls-editor-inactive-selection-bg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--ls-editor-selection-bg)" },
  ".cm-tooltip": {
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)",
    borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--ls-menu-selection-bg)", color: "var(--ls-menu-selection-fg)" },
  // Each item is a row with its label on the left and its description pushed to the right, as in a menu.
  ".cm-tooltip-autocomplete ul li": { display: "flex", alignItems: "baseline", gap: "var(--ls-space-4)" },
  ".cm-completionDetail": { marginLeft: "auto", fontStyle: "normal", fontSize: "var(--ls-text-sm)", color: "var(--ls-desc)" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "var(--ls-link)" },
  ".cm-tooltip-autocomplete ul li[aria-selected] :is(.cm-completionDetail, .cm-completionMatchedText)": { color: "inherit" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-error)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-warning)" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-section-fg)" },
  ".cm-lint-marker-error": { content: "none", backgroundColor: "var(--ls-error)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  ".cm-lint-marker-warning": { content: "none", backgroundColor: "var(--ls-warning)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  // The popover a gutter or lens button opens beside its line (toggleLinePopover): the notes of a cite, the threads of a comment.
  ".ls-line-popover": {
    position: "fixed", zIndex: "100", maxWidth: "min(32em, 90vw)", maxHeight: "50vh", overflowY: "auto", boxSizing: "border-box",
    padding: "var(--ls-space-3)", backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)",
    borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)",
  },
  ".ls-line-popover:focus": { outline: "none" },
  // An underline alone: a tinted background drowns the syntax colours of a long commented range.
  ".ls-comment-range": { borderBottom: "1px solid var(--ls-mark-accent)" },
  // The editor's font and line height, so 1lh is one text row and the icon sits centred on the line number's row, also on a wrapped line.
  ".ls-comment-marker": {
    display: "flex", alignItems: "center", justifyContent: "center", width: "1.3em", height: "1lh", font: "inherit", lineHeight: "inherit", padding: "0", border: "none", background: "none",
    color: "var(--ls-mark-accent)", cursor: "pointer",
  },
  ".ls-comment-marker svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)" },
  // Two or more threads on a line share one marker, their count as an exponent on the icon.
  ".ls-comment-count": { fontSize: "0.7em", lineHeight: "1", alignSelf: "flex-start", marginLeft: "1px" },
  ".ls-comment-popover": { width: "min(26em, 90vw)" },
  ".ls-comment-popover-thread + .ls-comment-popover-thread": { marginTop: "var(--ls-space-3)", paddingTop: "var(--ls-space-3)", borderTop: "1px solid var(--ls-menu-border)" },
  // The text a thread is on, as a quote in the editor's font, so threads of one line tell apart.
  ".ls-comment-popover-quote": {
    marginBottom: "var(--ls-space-2)", paddingLeft: "var(--ls-space-3)", borderLeft: "2px solid var(--ls-mark-accent)",
    color: "var(--ls-desc)", fontFamily: "var(--ls-code-font)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  ".ls-comment-popover-comment + .ls-comment-popover-comment": { marginTop: "var(--ls-space-3)" },
  ".ls-comment-popover-head": { display: "flex", gap: "var(--ls-space-3)", alignItems: "baseline", color: "var(--ls-desc)" },
  ".ls-comment-popover-head strong": { color: "var(--ls-fg)" },
  ".ls-comment-popover-body": { marginTop: "var(--ls-space-1)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  ".ls-comment-popover-open": { marginTop: "var(--ls-space-4)" },
  // The comment column keeps its width with no thread, so the "+" sits between the line number and the fold chevron, as in VS Code.
  ".ls-comment-gutter": { minWidth: "1.3em" },
  // A wrapped line's gutter element is as tall as all its rows; the "+" stays on the first one. No padding: the column is the "+".
  ".ls-comment-gutter .cm-gutterElement": { display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "0" },
  ".ls-comment-add": {
    display: "flex", alignItems: "center", justifyContent: "center", width: "1.2em", height: "1.2em", marginTop: "calc((1lh - 1.2em) / 2)", padding: "0",
    border: "1px solid var(--ls-menu-border)", borderRadius: "var(--ls-radius-sm)",
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-fg)", cursor: "pointer",
  },
  ".ls-comment-add svg": { width: "0.9em", height: "0.9em" },
  ".ls-comment-add:hover": { backgroundColor: "var(--ls-toolbar-hover)" },
  ".cm-panels": { backgroundColor: "var(--ls-bg)", color: "var(--ls-fg)", borderTop: "thin solid var(--ls-border)" },
  ".ls-add-comment-panel": {
    display: "flex", alignItems: "center", gap: "var(--ls-space-2)", height: "calc(var(--ls-pane-footer-h) - 1px)",
    padding: "0 var(--ls-space-3)", boxSizing: "border-box",
  },
  ".ls-source-style": {
    display: "inline-flex", alignItems: "center", gap: "var(--ls-space-2)", minWidth: "0", maxWidth: "40%",
    height: "var(--ls-row-h)", padding: "0 var(--ls-space-2)", border: "none", background: "none",
    color: "var(--ls-desc)", fontSize: "var(--ls-text-sm)", borderRadius: "var(--ls-radius-sm)", cursor: "pointer",
  },
  ".ls-source-style span": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".ls-source-style svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)", flexShrink: "0" },
  ".ls-source-style:hover": { background: "var(--ls-toolbar-hover)", color: "var(--ls-fg)" },
  ".ls-source-style:focus-visible": { outline: "thin solid var(--ls-focus)" },
  // A top panel (the proofing notice, search) is parted from the text below it, not above it.
  ".cm-panels-top": { borderTop: "none", borderBottom: "thin solid var(--ls-border)" },
  // The proofing notice: its text, then its buttons at the right end, wrapping under the text on a narrow editor.
  ".ls-proofing-notice": {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--ls-space-2) var(--ls-space-4)",
    padding: "var(--ls-space-2) var(--ls-space-3)", boxSizing: "border-box",
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-fg)", fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)",
  },
  ".ls-proofing-notice-text": { flex: "1 1 16em", minWidth: "0" },
  ".ls-proofing-notice-actions": { display: "flex", gap: "var(--ls-space-2)", flexShrink: "0" },
  ".ls-proofing-notice .ls-btn": { height: "var(--ls-row-h)", padding: "0 var(--ls-space-3)", fontSize: "var(--ls-text-sm)" },
  ".ls-proofing-notice .ls-btn:disabled": { opacity: "0.6", cursor: "default" },
  ".ls-proofing-notice .ls-btn:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".cm-diagnostic": { whiteSpace: "pre-wrap" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--ls-error)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--ls-warning)" },
});

// Both languages are stream parsers: stex and the Typst parser emit the legacy style names these tags come from.
export const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--ls-code-keyword)" },
  { tag: [tags.tagName, tags.variableName], color: "var(--ls-code-command)" },
  { tag: tags.atom, color: "var(--ls-code-argument)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--ls-code-string)" },
  { tag: tags.number, color: "var(--ls-code-number)" },
  { tag: tags.special(tags.variableName), color: "var(--ls-code-math)" },
  { tag: tags.comment, color: "var(--ls-code-comment)", fontStyle: "italic" },
  { tag: tags.heading, color: "var(--ls-code-heading)", fontWeight: "bold" },
  { tag: tags.meta, color: "var(--ls-code-reference)" },
  { tag: tags.bracket, color: "var(--ls-code-bracket)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--ls-error)" },
]);

export const editorTheme: Extension = [theme, syntaxHighlighting(codeHighlight)];
