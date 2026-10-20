// Styles the source editor and its LaTeX and Typst highlighting from the core design tokens.
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
  ".cm-gutters": { backgroundColor: "var(--ls-bg)", color: "var(--ls-section-fg)", borderRight: "1px solid var(--ls-border-faint)" },
  // TRAP: The active line sits above the selection layer, so its background must be translucent.
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--ls-row-open)" },
  ".cm-selectionBackground": { backgroundColor: "var(--ls-editor-inactive-selection-bg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--ls-editor-selection-bg)" },
  ".cm-tooltip": {
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)",
    borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--ls-menu-selection-bg)", color: "var(--ls-menu-selection-fg)" },
  ".cm-completionDetail": { color: "var(--ls-section-fg)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-error)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-warning)" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-section-fg)" },
  ".cm-lint-marker-error": { content: "none", backgroundColor: "var(--ls-error)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  ".cm-lint-marker-warning": { content: "none", backgroundColor: "var(--ls-warning)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  ".ls-comment-range": { backgroundColor: "color-mix(in srgb, var(--ls-mark-accent) 22%, transparent)", borderBottom: "1px solid var(--ls-mark-accent)" },
  ".ls-comment-gutter": { width: "1.6em" },
  ".ls-comment-marker": {
    display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "0", border: "none", background: "none",
    color: "var(--ls-mark-accent)", cursor: "pointer",
  },
  ".ls-comment-marker svg": { width: "12px", height: "12px" },
  ".cm-panels": { backgroundColor: "var(--ls-bg)", color: "var(--ls-fg)", borderTop: "1px solid var(--ls-border-faint)" },
  ".ls-add-comment-panel": { display: "flex", justifyContent: "flex-end", padding: "4px 8px" },
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
