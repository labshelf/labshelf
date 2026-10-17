# Apps: setup and verification

Read when you set up the toolchain or verify any app for real.

This folder explains how to build, run and verify each app. App-specific details are in [vscode.md](vscode.md), [browser.md](browser.md) and [terminal.md](terminal.md).

## Prerequisites

- Node.js 22.13 or later (needed by `node:sqlite` and pdf.js), and pnpm 9 or later.
- `pnpm install` at the repository root.

## Website

`pnpm --filter @labshelf/website build` bundles the demos that mount core UI into `website/dist/`. Serve `website/` with any static server, for example `npx serve website`; the demos are ES modules, which browsers do not load from `file://`.

The demos and recordings use the library in `website/demo-library/`, which commits one PDF; licences are in its `LICENSES.md`. `node website/tools/fetchDemoLibrary.mjs <dest>` copies it to `<dest>` and downloads the other PDFs from arXiv. Record against that copy, never the committed folder.

## Verifying changes

Unit tests do not cover webview DOM, the real extension host or a real terminal. After a change in one of those areas, verify it for real, following the recipe in the app's document:

| Change | Recipe |
|---|---|
| import, OCR, text layer, anything pdf.js does in the extension host | [vscode.md → extension host run](vscode.md#extension-host-run) |
| webview or reader UI, list panel | [vscode.md → webview harness](vscode.md#webview-harness) |
| core library list and detail layout (light, dark, narrow) | `pnpm verify:library` mounts the core library UI on a made-up library and writes screenshots and console errors to `.verify/library/`; the VS Code theme variables are approximate |
| browser extension pages, popup, capture | [browser.md → headless run](browser.md#headless-run) |
| TUI layout, keys, terminal output | [terminal.md → verification](terminal.md#verification) |
| PDF finding: resolvers, download, miss reasons | `pnpm --filter @labshelf/core eval:pdf` runs the corpus in `packages/core/tools/pdf-eval/` against the live network (needs network; reports are git-ignored) |

Rules for every recipe:

- **Never run against the user's real library.** Use a copy: `cp -R ~/Documents/LabShelfLibrary <scratch>/lib`.
- **Isolate config and tokens.** Point `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` at scratch directories, and use a throwaway `--user-data-dir`.
- **Use a real paper as well as synthetic fixtures.** Synthetic PDFs miss real-world failures: OCR layers, scans, margin stamps, missing link annotations.
- **Look at the screenshots.** A passing DOM assertion does not prove the layout is right.
- One-off harness scripts live in the session scratchpad. A harness that more than one session uses is committed under `scripts/`.
- On this Mac, `/Applications/Google Chrome.app` crashes in headless mode. Use Playwright's Chrome for Testing or its headless shell from `~/Library/Caches/ms-playwright/`, launched outside the sandbox.
- The `chrome-devtools` server in `.mcp.json` points `--executablePath` at `${HOME}/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`; `--channel` accepts only installed Chrome channels. After `npx playwright install chromium` changes `<ver>`, update the path to the folder that `ls ~/Library/Caches/ms-playwright/` shows.
