# Session 3 scout: HTML theme.css (explorer, sha 503a0c4aa)

- themeCss.ts (141 lines): readThemeProperties 115-122 (first top-level :root, `--*` declarations with value ranges, comment and string aware), setThemeProperty 124-141 (replaces the last declaration of the name, appends missing at the end of :root, creates :root; RangeError on bad name/value). Private scanner 16-113 (findRootRule, readDeclarations, skipOpaque, findBlockEnd). Test: __tests__/decks/themeCss.test.ts.
- Callers: deckValidate.ts 268-274 (DECK024), dom/themePanel.ts (Theme popover, D4 removes it in session 4), dom/shell/html/props.ts 43-51 (themeSection), dom/shell/html/chrome.ts 35-39, dom/deckEditorCore.ts 112-140 (changeTheme -> commitSteps with a new theme string = one undo step; editTheme(name, value) is one property only).
- Scaffold theme.css (deckProject.ts themeOf 85-109): `:root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; --deck-accent: #2563eb; --deck-font: system-ui, sans-serif; }`, body uses var(--deck-bg/fg/font), h1 var(--deck-accent). No grid declaration anywhere yet (session 8).
- theme.css is a separate file beside deck.html; hosts persist {html, theme} from onChange.
- Contract decks.md "## Theme" 206-210; "### HTML decks" 120-131 (line 122 still names deckShell/, stale).
