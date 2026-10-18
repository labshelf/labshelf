// Styles the source editor and its LaTeX highlighting from the core design tokens.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--ls-fg)", backgroundColor: "var(--ls-bg)", fontSize: "var(--ls-font-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ls-mono)" },
  ".cm-content": { caretColor: "var(--ls-fg)" },
  ".cm-gutters": { backgroundColor: "var(--ls-bg)", color: "var(--ls-section-fg)", borderRight: "1px solid var(--ls-border-faint)" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--ls-list-inactive-bg)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--ls-row-selected)" },
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
  ".cm-diagnostic": { whiteSpace: "pre-wrap" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--ls-error)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--ls-warning)" },
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], color: "var(--ls-mark-accent)" },
  { tag: tags.comment, color: "var(--ls-section-fg)", fontStyle: "italic" },
]);

export const editorTheme: Extension = [theme, syntaxHighlighting(highlight)];
