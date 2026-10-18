# Log: browser project workspace

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-10-18 — session 1 done: transport-spike.md (no browser blocks the loopback socket; Firefox needs upgrade-insecure-requests removed)
- 2026-10-18 — session 2 done: tree/checklist/outline, All projects library and gallery host in core; 2.2 split in two after a budget stop
- 2026-10-18 — session 4 done: helper --register serves both hosts, labshelf-bridge alias, argv0/--host=bridge dispatch; SEA run answered bridge hello
- 2026-10-18 — session 3 done: one-pass preview, \includeonly of the edited chapter, pdflatex preamble .fmt (preview 240 ms vs full 991 ms)
- 2026-10-18 — session 5 done: helper protocol v2 (native hello → loopback socket, edits, changed pages), browser client, review fixes; real browser build run deferred to session 9
- 2026-10-18 — session 6 done: managed Tinymist 0.15.10 (own lock in the shared tools folder), helper LSP relay and Typst compile, VS Code language server; A11 not run in a VS Code host
- 2026-10-18 — session 7 done: TeX -no-shell-escape/openout_any=p/-norc, Tinymist confined (no raw file:, no page config, minimal env), pinned TinyTeX, signed install-tl, private modes, redaction, --uninstall, signed Windows releases required; Q1: macOS stays ad-hoc
- 2026-10-18 — session 8 done: core editor area, workspace shell with page sidebar, tab chunks, hash + sessionStorage restore, project session with Files/Outline/Checklist, All projects/Templates tabs (My templates and template cache now runtime-neutral in core), sidebar sections setting; headless A1–A3/A10 run deferred to the session 9 check
- 2026-10-18 — session 12 done: core row window, paper list and All projects treegrid virtualized (34px rows kept, model-based keys, focus parking); headless 2,000-row timing left to the session 13 perf check
- 2026-10-18 — session 9 done: CodeMirror LaTeX editor (lazy chunk), live preview from helper pages, helper project per page; real run passed A1, A2; fixed helper WebSocket refusing permessage-deflate, SEA bundle missing pdf-lib, browser paper cache rebuild
- 2026-10-18 — session 10 done: Typst LSP client over the helper (hand-written, no page didChange), comments store in core + browser panel and editor marks, history runtime-neutral in core + IndexedDB storage + History tab; Compare Versions desktop-only
- 2026-10-18 — session 11 done: section preview (state capture at shipout, assembly, own-aux labels, page swap); 108-page run keeps numbering; section preview ~280–480 ms vs full ~1.3 s
- 2026-10-18 — session 13 (deletions) done: monaco-vscode page, VS Code web build, editor-host contract and browser-editor plan removed; isWeb/desktop-only gates removed; typst.ts kept (VS Code desktop builds use it)
