// Styles the "Save to LabShelf" split button and its states: a VS Code split button on the kit's secondary-button colours.

export const BUTTON_CSS = `
.lsx { display: inline-flex; align-items: stretch; height: 24px; font-size: 12px; line-height: 16px; border-radius: var(--ls-radius); background: var(--ls-button2-bg); color: var(--ls-button2-fg); }
.lsx button { display: inline-flex; align-items: center; margin: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; transition: background var(--ls-fast); }
.lsx button:hover { background: var(--ls-button2-hover); }
.lsx-main { gap: 7px; padding: 0 10px 0 4px; border-radius: var(--ls-radius) 0 0 var(--ls-radius); white-space: nowrap; }
.lsx-caret { justify-content: center; width: 22px; padding: 0; border-radius: 0 var(--ls-radius) var(--ls-radius) 0; }
.lsx-caret svg { width: 14px; height: 14px; opacity: .8; }
.lsx-sep { width: 1px; margin: 5px 0; background: var(--ls-border-soft); }
.lsx-mark { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0;
  border-radius: var(--ls-radius-sm); background: var(--ls-button-bg); color: var(--ls-button-fg); }
.lsx-mark svg { width: 11px; height: 11px; }
.lsx[data-state="saving"] .lsx-mark svg { animation: lsx-spin 1.2s linear infinite; }
.lsx[data-state="saving"] button { cursor: progress; }
.lsx[data-state="saved"] .lsx-mark { background: var(--ls-status-done); }
.lsx[data-state="saved"] .lsx-sep, .lsx[data-state="saved"] .lsx-caret { display: none; }
.lsx[data-state="saved"] .lsx-main { border-radius: var(--ls-radius); }
.lsx[data-state="error"] .lsx-mark { background: var(--ls-error); }
.lsx[data-state="confirm"] .lsx-mark { background: var(--ls-yellow); }
/* Saved without a PDF: a muted badge, not the green "done" mark. Placed after
   the saved rule so it wins at equal specificity. */
.lsx[data-pdf="none"] .lsx-mark { background: var(--ls-badge-bg); color: var(--ls-badge-fg); }
@keyframes lsx-spin { to { transform: rotate(360deg); } }
`;
