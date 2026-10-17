# Plan: Website with real recordings, real interactive demos and a useful manual

Status: draft
Size: 5 sessions — one foundation session, three media sessions that run in parallel, one content session

## 1. Goal

The website shows LabShelf as it really is: looping recordings of the real VS Code extension, browser extension and terminal app, and interactive demos built from the real core library UI and reader. Visitors can use these demos on the page. The manual turns into tutorials for features that exist, and a support section near the top asks for funding.

## 2. Decisions

- [ ] **D1** The site describes only features that exist in the code. The visual concept stays: a terminal session, with paper sheets and a manual opened in the reader. The copy changes where the code differs: highlights are colours, not meanings; real commands, settings and keys; sync goes through Google Drive, not a local port. — Recordings and tutorials of features that do not exist would mislead visitors. The source of truth is [research/features.md](research/features.md).
- [ ] **D2** `website/` becomes the private workspace package `@labshelf/website`, which depends on `@labshelf/core`. It sits outside `packages/`, because it is not one of the four product packages. esbuild bundles `website/src/demos/*.ts` into `website/dist/`, which git ignores. `architecture.md` lets the website mount core's library UI and reader through their host contracts. — The user chose the real core UI over hand-built replicas, so the demos stay identical to the apps.
- [ ] **D3** A demo library of 8–10 real papers with a licence that allows redistribution (CC BY or CC0 on arXiv) is written in the real library format under `website/demo-library/`. The recordings and the interactive demos use it. `metadata.yaml` files are committed. Only the PDF the reader demo needs is committed; a script downloads the others. — It is one fixture for every medium, and no user data is involved.
- [ ] **D4** Recordings are H.264 MP4 plus WebM, with a JPG poster. They play as `<video autoplay muted loop playsinline>`, are recorded at device scale 2 and are at most about 3 MB each. Terminal and browser are recorded headlessly, with no screen permission. VS Code is recorded from an isolated `@vscode/test-electron` copy in a visible window, captured by its window bounds. — The user chose looping video and a real isolated VS Code window.
- [ ] **D5** Support links to GitHub Sponsors (`https://github.com/sponsors/lucaanasser`) as a stand-in until the user picks a platform. The URL appears once in `index.html`. — The user has not decided; Sponsors needs no extra account.
- [ ] **D6** Clip names are fixed here so sessions can run in parallel. The names below are paths under `website/media/`, each with `.mp4`, `.webm` and `.jpg`:
  - `vscode/library`: folders, search `status:reading`, detail pane;
  - `vscode/add-paper`: Add Paper by DOI or Link…;
  - `vscode/reader`: select text, highlight a colour, Copy with citation, hover a reference;
  - `vscode/cite-completion`: `\cite[` lists highlights and inserts `\cite[p.~4]{key}`;
  - `vscode/preview`: `.tex` beside the preview, undefined citation, Replace with…, recompile, F8;
  - `vscode/check`: Check Before Submitting;
  - `terminal/tui`: navigate, filter, preview tabs, `yc`;
  - `terminal/cli`: `add`, `search`, `bib`;
  - `browser/capture`: arXiv page, popup save, paper in the library page;
  - `browser/scholar` is optional: the Scholar button, if Scholar does not block headless Chrome.
- [ ] **D7** The interactive demos are mounted into `[data-demo="library"]` and `[data-demo="reader"]`. Session 2 creates the modules, and session 5 places the containers in `index.html`.

## 3. Acceptance

- [ ] **A1** `pnpm --filter @labshelf/website build` writes `website/dist/`, and the page served statically shows no console errors.
- [ ] **A2** The library demo shows the demo library in the real core UI. Search, filter, status changes and the detail pane work with no backend.
- [ ] **A3** The reader demo opens a real paper with pdf.js. Selecting text offers highlight colours and Copy with citation.
- [ ] **A4** Every clip in D6 exists, loops and plays muted inline in Chrome and Safari, and is at most about 3 MB.
- [ ] **A5** Every command, key, setting and label named on the site exists in [research/features.md](research/features.md) or in the code.
- [ ] **A6** The manual holds tutorials for: first library, adding papers, organizing, reading and highlighting, writing with checks, syncing apps, the terminal, settings and privacy. Each has steps and the result to expect.
- [ ] **A7** A support section sits right after the hero and links to the D5 URL.
- [ ] **A8** No recording or demo shows user data. The real library, config and Drive are never touched.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-foundation.md](sessions/1-foundation.md) | website package, build, demo library, architecture rule | `website/package.json`, `website/build/`, `website/demo-library/`, `website/tools/fetchDemoLibrary.mjs`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `documents/architecture.md` | alone |
| 2 | [sessions/2-interactive-demos.md](sessions/2-interactive-demos.md) | library and reader demos on the real core UI | `website/src/demos/`, `website/css/demos/` | 3, 4 |
| 3 | [sessions/3-record-terminal-browser.md](sessions/3-record-terminal-browser.md) | terminal and browser clips | `website/tools/record/` (except `vscode/`), `website/media/terminal/`, `website/media/browser/` | 2, 4 |
| 4 | [sessions/4-record-vscode.md](sessions/4-record-vscode.md) | VS Code clips from an isolated window | `website/tools/record/vscode/`, `website/media/vscode/` | 2, 3 |
| 5 | [sessions/5-content.md](sessions/5-content.md) | true copy, tutorials, support section, wiring | `website/index.html`, `website/css/` (except `demos/`), `website/js/` | alone, after 2–4 |
