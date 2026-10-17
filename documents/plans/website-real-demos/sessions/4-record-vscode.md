# Session 4 — VS Code recordings from an isolated window

- **Goal:** record the VS Code clips from a real, isolated VS Code window running the LabShelf extension on the demo library.
- **Starts from:** session 1 committed. The user is at the machine: the first run needs macOS Screen Recording permission for the terminal app.
- **Ends with:** `website/media/vscode/{library,add-paper,reader,cite-completion,preview,check}` exist, each as `.mp4`, `.webm` and `.jpg`, each at most about 3 MB (A4, A8).
- **Owns:** `website/tools/record/vscode/`, `website/media/vscode/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Isolated VS Code host, driven over CDP | behaviour | main thread (opus) | window opens on the demo library and a script drives it | [ ] |
| 4.2 | Record the six scenarios | behaviour | main thread (opus) | six clips | [ ] |
| 4.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

This runs in the main thread, because it needs the user present for the permission prompt and judgment on every take.

**Safety rules, all of them binding:**

- Download VS Code with `@vscode/test-electron` (`npx @vscode/test-electron`, or a small script using `downloadAndUnzipVSCode`) into the scratchpad. Never run `/Applications/Visual Studio Code.app`.
- Launch with a short `--user-data-dir` (under about 103 characters), a scratch `--extensions-dir` and `--remote-debugging-port`. Record the PID.
- Stop only that PID. Never use `killall` or `pkill` by name; the user's own VS Code windows must stay open.
- Ask the user before the first launch.
- Use only the demo library copy (`node website/tools/fetchDemoLibrary.mjs <scratchpad>/lib`) and scratch XDG directories. Never connect Drive.

## 4.1 — Isolated host, driven over CDP

- **Read only:**
  - `documents/apps/vscode.md`, "Build and run", "Extension host run" and "Webview harness";
  - the memory notes on extension-host e2e and "no installed VS Code for checks";
  - `packages/vscode/package.json`, for the command ids;
  - `documents/plans/website-real-demos/research/features.md`, the VS Code section.
- **Decided:**
  - Build the extension (`pnpm --filter @labshelf/vscode build`) and load it with `--extensionDevelopmentPath`.
  - Settings in the scratch profile: the Dark Modern theme, a window size of 1600×1000, minimap off, the welcome screen off, font size 15, and the library path set to the demo copy (with "Configure Library", or the stored config path the extension reads).
  - Drive it with Playwright `chromium.connectOverCDP` on the remote-debugging port. Run commands through the command palette (Cmd+Shift+P, then type). Reach the webviews as frames of the workbench page.
  - Capture with `ffmpeg -f avfoundation` cropped to the window bounds, read from CDP (`window.screenX/Y`, `outerWidth/Height` × the device scale). An alternative is a CDP `Page.startScreencast` on the workbench page; prefer it if it captures the webviews, because it needs no screen permission.
- **Done when:** a script opens the window on the demo library, opens the List tab and quits by PID.

## 4.2 — Six scenarios

Script these in `website/tools/record/vscode/scenarios.mjs`, one take each, 8–14 s loops:

- **library:** folders, then search `status:reading`, then select a paper; the detail pane shows the real fields.
- **add-paper:** "Research: Add Paper by DOI or Link…", paste a CC BY arXiv id; the paper appears.
- **reader:** open the demo PDF, select a sentence, click Highlight yellow, then Copy with citation, then hover a reference card.
- **cite-completion:** in the demo project's `.tex`, type `\cite[`, pick a highlight; `\cite[p.~4]{key}` is inserted.
- **preview:** "Research: Show Preview" beside the `.tex`. Hover the undefined citation, click "Replace with …", recompile, press F8.
- **check:** "Research: Check Before Submitting" and its results.

Encode with `website/tools/record/encode.mjs`, written by session 3. If session 3 has not committed it yet, wait, or write `website/tools/record/vscode/encode.mjs` with the same flags and delete it once 3 lands.

- **Done when:** the six clips play, show no personal paths or names, and are each at most about 3 MB.
