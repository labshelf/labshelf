# Log: One workspace for talks and posters: Code, Split and Visual

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-11-02 18:24 — session 0 done: 0.1, 0.2
- 2026-11-02 21:40 — session 1 closed: its code and contract were already on main (f32da287); tests green.
- 2026-11-02 21:40 — sessions 2–4 done in one pass: core workspace (decks/dom/workspace), LabShelf Editor in VS Code and the browser source tab, Visual/Split/Code, build loop, action bar, properties, talk thumbnails, notes and Layout. Checked by hand in a VS Code dev host on deck-showcase (tikzposter, beamer) and typst-posters.
- 2026-11-02 21:40 — deviation D6/D8: beamer tags a frame's whole content with its \end{frame} line and tikzposter tags the poster with \end{document}, so SyncTeX places only slides. Nodes are also placed through the PDF text layer (titles for poster blocks, words for elements). The browser Helper therefore gets no synctex field: the text layer serves it as it serves Typst.
- 2026-11-02 21:40 — session 5 (D7): chose (b) text-layer matching without measuring (a); (b) costs no extra Typst run and is the same code LaTeX needs anyway. typst-a0 blocks select by title in VS Code.
- 2026-11-02 21:40 — session 6 partial: HTML decks get a properties panel (text style, position in px/cm) and shapes beside the existing editor; the editor is not reorganised into the workspace shell (Slides/Elements tabs, cm ruler, Split mode) yet.
- 2026-11-02 21:40 — session 7 done: shapes (deckStyle.ts) and the Theme menu (sourceDeckThemes.ts). Session 8 stays blocked on feature/charts.
- 2026-11-02 21:40 — session 9: decks contract, product.md and ui.md describe the workspace. Not done: the browser workspace was not run by hand (needs a library folder and the Helper); the user's own checks A3–A9.
