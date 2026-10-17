# Session 3 — Terminal and browser recordings

- **Goal:** produce the terminal and browser clips from the real apps, headlessly, on a copy of the demo library.
- **Starts from:** session 1 committed (`website/tools/fetchDemoLibrary.mjs` exists).
- **Ends with:** `website/media/terminal/{tui,cli}` and `website/media/browser/capture` exist, each as `.mp4`, `.webm` and `.jpg`, each at most about 3 MB (A4, A8). `browser/scholar` is made only if Scholar does not block headless Chrome.
- **Owns:** `website/tools/record/` (except `website/tools/record/vscode/`), `website/media/terminal/`, `website/media/browser/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Terminal: pty capture, replay in xterm.js, encode | behaviour | implementer (opus) | two terminal clips | [ ] |
| 3.2 | Browser: extension in headless Chrome, screencast, encode | behaviour | implementer (opus) | capture clip | [ ] |
| 3.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

3.1 and 3.2 run in parallel; they share only `website/tools/record/encode.mjs`, which 3.1 writes first.

**Isolation, for both packages:**

- Run `node website/tools/fetchDemoLibrary.mjs <scratchpad>/lib`.
- Point `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` at the scratchpad, and set `LABSHELF_TOKEN_STORE=file`. Use a throwaway `--user-data-dir`.
- Never touch the real library, config, keychain or Drive. Never use `/Applications` apps.

## 3.1 — Terminal

- **Goal:** script real sessions. Run the real TUI and CLI in a pty, record the byte stream with timings, then replay it into xterm.js in headless Chromium. Capture frames with a CDP screencast, at device scale 2, and encode them with ffmpeg.
- **Read only:**
  - `documents/apps/terminal.md`, "Build and run" and "Verification" (the pty harness);
  - `packages/terminal/src/ui/keymap.ts:35-118`;
  - `packages/terminal/src/cli/usage.ts`;
  - `documents/plans/website-real-demos/research/features.md`, the Terminal section.
- **Decided:**
  - Scripts: `website/tools/record/terminal.mjs` (the scenarios) and `website/tools/record/encode.mjs`, a shared encoder for frames to H.264 MP4, VP9 WebM and a JPG poster at 1600 px wide.
  - xterm.js is installed as a devDependency of `@labshelf/website`, or loaded from a pinned CDN URL inside the recorder page only. Pick the CDN, because session 1 owns the lockfile.
  - Theme: the site's ink palette (`website/css/tokens.css`) and Martian Mono.
  - Scenarios: `tui` runs `j`/`k` through folders, `f` with `status:reading`, `tab` through the preview tabs, then `yc`. `cli` runs `labshelf add <arXiv id of a paper not in the fixture>`, then `labshelf search tag:<tag>`, then `labshelf bib -o refs.bib`.
  - Each loop runs 8–14 s.
  - Build the terminal first (`node packages/terminal/build/build.mjs`).
- **Done when:** both clips play, show real output, are at most about 3 MB, and show no scratchpad paths with the user's name. Set `HOME`, and the prompt shown, to `~/thesis`.
- **Do not touch:** `packages/`, `website/index.html`.

## 3.2 — Browser

- **Goal:** load the built extension into Playwright's Chrome for Testing (`--headless=new --load-extension`), seed its IndexedDB from the demo library, and record one scenario. It opens the arXiv abstract page of a CC BY paper, opens the popup page in a tab next to it, saves, then opens the library page and shows the paper. Use a CDP screencast at device scale 2, and encode with `encode.mjs`.
- **Read only:**
  - `documents/apps/browser.md`, "Headless run" and "Platform constraints";
  - `packages/browser/src/popup/` (its entry file only);
  - `packages/browser/src/storage/paperRecordStore.ts`, for the IndexedDB shape to seed;
  - the memory note on the headless harness: the Playwright headless shell works, `/Applications/Google Chrome.app` fails headless;
  - `website/tools/record/encode.mjs`.
- **Decided:**
  - Script: `website/tools/record/browser.mjs`.
  - Build: `pnpm --filter @labshelf/browser build:chrome`. If OAuth credentials are missing, build with what exists. Sync is not recorded.
  - The popup is recorded as a tab page sized like the popup, composited beside the page with ffmpeg `overlay`. The real popup window cannot be screencast.
  - Run outside the sandbox when Chrome needs it.
- **Done when:** `capture` plays and shows a real save of a real arXiv paper into the library page. The clip is at most about 3 MB.
- **Do not touch:** `packages/`, `website/index.html`.
