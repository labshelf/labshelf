---
name: verify
disable-model-invocation: true
description: Run and verify a LabShelf app for real — the VS Code extension host, the webview/reader UI in headless Chrome, the browser extension, or the terminal TUI — on an isolated copy of the library, and look at the result. Use after UI, import/OCR/pdf.js, extension-host or terminal changes, or when asked to run, launch or screenshot an app.
context: fork
agent: general-purpose
model: sonnet
effort: medium
background: false
---

The recipes live in `documents/apps/`. Pick the one for the change:

| Change | Recipe |
|---|---|
| import, OCR, text layer, pdf.js in the extension host | `documents/apps/vscode.md` → "Extension host run" |
| reader UI, list panel, any VS Code webview | "Browser and webview pages" below, with the stubs from `documents/apps/vscode.md` → "Webview harness" |
| browser pages, popup, Scholar button, capture | "Browser and webview pages" below; `documents/apps/browser.md` → "Headless run" for what the tools cannot reach |
| TUI layout, keys, terminal output | `documents/apps/terminal.md` → "Verification" |

## Browser and webview pages

Drive them with the `mcp__chrome-devtools__*` tools. The server in `.mcp.json` runs Playwright's headless Chrome for Testing with an isolated profile, so it needs no hand-written CDP harness. These tools exist only in the main thread and in unrestricted agents; restricted agents such as `implementer` do not have them. If they are missing, say so and fall back to the CDP recipe in the app document.

1. Rebuild (`pnpm --filter @labshelf/browser build:chrome` for the extension).
2. Browser extension: `install_extension` with the absolute `packages/browser/dist/chrome` path returns the id; `new_page` on `chrome-extension://<id>/popup/index.html` (or `library-page/`, `options/`); `trigger_extension_action` opens the popup the way the toolbar button does; `reload_extension` after a rebuild.
3. Webview: serve the built HTML and the repo statically, then `new_page` and `navigate_page` with `initScript` holding the `acquireVsCodeApi` stub described in the webview harness and the `:root{--vscode-*}` block. TRAP: `initScript` runs before `<html>` exists, so append the `<style>` on `DOMContentLoaded`; touching `document.documentElement` throws and the page falls back to serif fonts.
4. Check every page with `take_screenshot` (`filePath` under `<repo>/.verify/`, which git ignores; the server refuses paths outside the workspace, the scratchpad included; empty `.verify/` before the run so only this run's shots stay) and `list_console_messages`; a page with console errors fails. `take_snapshot`, `click` and `evaluate_script` (pass the `pageId` that `new_page` lists) cover interaction and DOM asserts.

## Always
1. Rebuild the app first; a stale bundle shows old behavior.
2. Work on a copy: `cp -R ~/Documents/LabShelfLibrary <scratchpad>/lib`. Point `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` at the scratchpad and use a throwaway `--user-data-dir`. Never touch the real library, config, keychain or Drive.
3. One-off scripts go in the session scratchpad. A harness more than one session uses lives in the repo (a plan's wave-1 tooling): the library list harness is `scripts/verify-library/`.
4. Launch browsers and VS Code outside the sandbox (they fail inside it). Use Playwright's Chrome for Testing / headless shell; `/Applications/Google Chrome.app` crashes headless on this machine. Stop only the processes you started, by PID.
5. Exercise the change with a real paper from the copy, not only synthetic fixtures.
6. Read the screenshots or text frames yourself before reporting.
7. Stop only the processes you launched, by PID or by the unique `--user-data-dir` path. Never `pkill`/`killall` VS Code, Electron or Chrome by name: the user's own windows run from the same binaries and all of them close.
8. Never launch the installed `/Applications/Visual Studio Code.app` for an extension-host run: a test instance of the user's own app closed all their windows even with its own `--user-data-dir`. Use a copy downloaded by `@vscode/test-electron` into the scratchpad, and ask the user before the first run on it.

Return: what you exercised, what you saw (pass/fail per check), the absolute paths of the 1–3 screenshots that best show the result (the main model may open them), and anything the recipe could not reach (for example Cloudflare-protected downloads). No harness logs.
