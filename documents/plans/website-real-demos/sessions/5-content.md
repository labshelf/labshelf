# Session 5 — True copy, useful tutorials, support section, wiring

- **Goal:** the site says only what LabShelf does. The manual teaches it in tutorials, a support section asks for funding, and the clips and interactive demos replace every figure slot.
- **Starts from:** sessions 2, 3 and 4 committed. Clips are in `website/media/`, and the demos are in `website/src/demos/`.
- **Ends with:** A4–A8 pass on the served site; A1 still passes.
- **Owns:** `website/index.html`, `website/css/` (except `website/css/demos/`), `website/js/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Landing copy, support section, clips and demos wired | behaviour | implementer (opus) | A4, A5, A7 | [ ] |
| 5.2 | Manual rewritten as tutorials | behaviour | implementer (opus), after 5.1 | A5, A6 | [ ] |
| 5.3 | Finish, check, commit | — | `finish` skill on everything the plan touched, then `check`, `git commit` | gate passes | [ ] |

5.2 edits the manual part of `index.html` that 5.1 does not touch, but they share the file, so they run in order.

## 5.1 — Landing copy, support, wiring

- **Read only:**
  - `website/index.html:1-200`, from the header to the end of the `#web` section;
  - `website/css/page/*.css`, `website/css/tokens.css` and `website/js/page/*.js`;
  - `ls website/media/*/`, the clips (each `<name>.mp4`, `.webm`, `.jpg`).
  - `documents/plans/website-real-demos/research/features.md`;
- **Decided:**
  - **Hero:**
    - The typed command is real: `labshelf search status:reading` with real-looking output for the demo library, and status names unread, reading and done. Update `website/js/page/heroTyping.js` and the static HTML together.
    - Install rows: "Build from source" with the GitHub URL (`https://github.com/lucaanasser/labshelf`). Nothing is published, so there is no `code --install-extension` and no `npm i -g`.
  - **Support section:** add `<section class="cmd" id="support">` right after the hero, with the command line `labshelf sponsor`. Write two or three sentences, in the site's voice: LabShelf is free, open source and built by one person; funding pays for the time and keeps it free. Add one button to `https://github.com/sponsors/lucaanasser`, a stand-in until the user picks a platform; the URL appears once. Style it in `website/css/page/support.css`, solid blue, with no pill shape and no coloured-border card.
  - **Sections:**
    - Library: the `vscode/library` clip and the interactive library demo.
    - Read: the `vscode/reader` clip and the interactive reader demo. Highlights are colours.
    - Write: the `vscode/preview` and `vscode/cite-completion` clips. The scripted citation demo stays, with its real labels "Replace with vaswani2017attention" and the "Update to <venue>" wording.
    - CLI: the `terminal/tui` and `terminal/cli` clips. The scripted recording in `cliRecording.js` uses real commands, or is deleted once the clip replaces it; prefer deleting it.
    - Web: the `browser/capture` clip. The real mechanism is sync through Google Drive; remove the local port.
  - **Clips:** `<video autoplay muted loop playsinline preload="metadata" poster="….jpg">` with WebM, then MP4 sources. Pause it under `prefers-reduced-motion` and when it is off screen (IntersectionObserver), in a new `website/js/page/clips.js`.
  - **Demos:** `<div data-demo="library">` and `<div data-demo="reader">`, plus `<script type="module" src="dist/demos/library.js">` and `reader.js`.
  - Delete every `.slot` placeholder, the mock-ups in `website/css/page/mocks.css`, and the JS and CSS they used.
- **Done when:** served after `pnpm --filter @labshelf/website build`, every clip plays, both demos work, the console is clean, and no placeholder remains (`grep -n 'slot\|\.gif\|\.cast' website/index.html` is empty).

## 5.2 — Manual as tutorials

- **Read only:**
  - `website/index.html` from `<section class="rdr" id="man"` to its end;
  - `website/css/manual/*.css` and `website/js/manual/sections.js`;
  - `documents/plans/website-real-demos/research/features.md`.
- **Decided:**
  - Keep the paper form: title block, numbered sections, booktabs tables, the reader frame, the outline and the `man -k` search.
  - The highlight colours legend replaces the meanings: `[data-m]` in `website/css/tokens.css` becomes colour names (`yellow`, `green`, `blue`, `red`, `pink`) with the reader's colours. Update the selection bar and the toolbar swatches to match.
  - Sections, each written as task tutorials: numbered steps, the result to expect after each step, and a short "If it goes wrong" note.
    1. Getting started: build and install each app, pick a library folder, and connect Drive (optional).
    2. Adding papers: by DOI, arXiv, PMID or link; drag a PDF; capture from the browser and Scholar; `labshelf add`; duplicates; OCR.
    3. Organizing: folders, status, tags, the full search syntax as a table, and the Citation Map.
    4. Reading: highlight colours, Copy with citation and `citationStyle`, hover cards, notes, and Export Annotations.
    5. Writing: a project, the preview, citation checks (Replace with…, Update to…), F8, limits, `\cite[` completion, `labshelf:` links, Check Before Submitting, one chapter, the arXiv bundle, and templates.
    6. Sync across apps: Drive setup in each app, what syncs, and conflicts. Link to the behaviour, not the contract.
    7. Terminal: the TUI keys table and the CLI commands table, with `--json` where it is real.
    8. Settings: the real table.
    9. Privacy: the real network hosts.
    10. Citing LabShelf.
  - Each tutorial embeds the relevant clip or demo as a paper figure (`.afig`) where it helps; at most one per section.
  - The page breaks (`.pbreak`) and the margin notes stay.
- **Done when:**
  - Every named command, key and setting is in `research/features.md` or found by grep in `packages/`.
  - `man -k` finds each tutorial.
  - There are no console errors.
