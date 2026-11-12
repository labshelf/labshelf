---
name: verify
disable-model-invocation: true
description: Run and verify a LabShelf app for real — the VS Code extension host, the webview/reader UI in headless Chrome, the browser extension, or the terminal TUI — and look at the result. Use after UI, import/OCR/pdf.js, extension-host or terminal changes, or when asked to run, launch or screenshot an app.
context: fork
agent: general-purpose
model: sonnet
effort: medium
background: false
---

The recipes and platform traps live in `references/`. Read only the one for the change:

| Change | Recipe |
|---|---|
| import, OCR, text layer, pdf.js in the extension host | [references/vscode.md](references/vscode.md) → "Extension host run" |
| reader UI, list panel, any VS Code webview | "Browser and webview pages" below, with the stubs from [references/vscode.md](references/vscode.md) → "Webview harness" |
| browser pages, popup, Scholar button, capture | "Browser and webview pages" below; [references/browser.md](references/browser.md) for what the tools cannot reach |
| TUI layout, keys, terminal output, the Helper, the website | [references/terminal.md](references/terminal.md) |

## Browser and webview pages

Drive them with the `mcp__chrome-devtools__*` tools. The server in `.mcp.json` runs Playwright's headless Chrome for Testing with an isolated profile, so it needs no hand-written CDP harness. These tools exist only in the main thread and in unrestricted agents; restricted agents such as `implementer` do not have them. If they are missing, say so and fall back to the CDP recipe in the references.

1. Rebuild (`node scripts/agents/run.mjs cmd -- pnpm --filter @labshelf/browser build:chrome` for the extension).
2. Browser extension: `install_extension` with the absolute `packages/browser/dist/chrome` path returns the id; `new_page` on `chrome-extension://<id>/popup/index.html` (or `libraryPage/`, `options/`); `trigger_extension_action` opens the popup the way the toolbar button does; `reload_extension` after a rebuild.
3. Webview: serve the built HTML and the repo statically, then `new_page` and `navigate_page` with `initScript` holding the `acquireVsCodeApi` stub described in the webview harness and the `:root{--vscode-*}` block. TRAP: `initScript` runs before `<html>` exists, so append the `<style>` on `DOMContentLoaded`; touching `document.documentElement` throws and the page falls back to serif fonts.
4. Check every page with `take_screenshot` (`filePath` under `<repo>/.verify/`, which git ignores; the server refuses paths outside the workspace, the scratchpad included; empty `.verify/` before the run so only this run's shots stay) and `list_console_messages`; a page with console errors fails. `take_snapshot`, `click` and `evaluate_script` (pass the `pageId` that `new_page` lists) cover interaction and DOM asserts.

## Always
1. One-off scripts go in the session scratchpad. A harness more than one session uses lives in `scripts/verify/`.
2. Exercise the change with a real paper, not only synthetic fixtures.
3. Read the screenshots or text frames yourself before reporting.

Return: what you exercised, what you saw (pass/fail per check), the absolute paths of the 1–3 screenshots that best show the result (the main model may open them), and anything the recipe could not reach (for example Cloudflare-protected downloads). No harness logs.
