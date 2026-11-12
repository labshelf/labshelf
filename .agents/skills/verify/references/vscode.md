# VS Code

## Extension host run

Jest mocks `vscode`, and plain Node passes pdf.js's "am I Node?" check, so both hide bugs that appear only in the extension host. The host is an Electron utility process (`process.type === "utility"`), which pdf.js treats as a browser. Any change to import, OCR, the text layer or pdf.js usage must run in a real host:

1. Create a dummy extension: a `package.json` with `main` and empty `activationEvents`, plus a runner file exporting `run = async () => {…}`. In the runner, `require("vscode")` is real. Write runner files with a quoted heredoc (`<<'EOF'`).
2. Launch the binary of a `@vscode/test-electron` copy directly (the `code` CLI wrapper detaches), outside the sandbox:

   ```bash
   env -u ELECTRON_RUN_AS_NODE "<test-electron copy>/Contents/MacOS/Code" --no-sandbox \
     --user-data-dir=<SHORT path> --extensions-dir=<scratch> --disable-workspace-trust --skip-welcome \
     --skip-release-notes --disable-telemetry --disable-updates \
     --extensionDevelopmentPath=<dummy> --extensionTestsPath=<runner.js> <workspace>
   ```

   `--extensionTestsPath` puts VS Code in test mode, which refuses authentication dialogs; a check that needs an interactive sign-in launches without it.
3. Keep `--user-data-dir` under about 103 characters (IPC socket path limit). The scratchpad path is too long: symlink it from a short path.
4. The runner cannot see contributed views. A "Bad progress location" log line is harness noise.

A cheaper middle ground reproduces pdf.js's environment but not the host lifecycle: run the script with `ELECTRON_RUN_AS_NODE=1 ".../Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)"` after setting `process.type = "utility"`. To test scans, render a real paper's pages to PNG and rebuild an image-only PDF; synthetic PDFs miss OCR layers, scans, margin stamps and missing link annotations.

## Collaboration host run

Use a local relay ([browser.md](browser.md#collaboration-against-a-local-relay)) with the scratch CA in `NODE_EXTRA_CA_CERTS` and `NO_PROXY=127.0.0.1,localhost`.

- Launch hosts under `xvfb-run -a` with a short `--user-data-dir`, `--remote-debugging-port` and `--inspect-extensions`. Never use `--inspect-brk-extensions`: the renderer restarts the host after 10 s.
- On Linux without a keyring, add `--password-store=basic`; otherwise every SecretStorage write never resolves.
- User settings `http.proxySupport: "off"`, `http.fetchAdditionalSupport: false`, `http.webSocketAdditionalSupport: false`: VS Code otherwise patches the host's global `fetch` and `WebSocket` with its own CA list, which drops `NODE_EXTRA_CA_CERTS`.
- Stop a host with `kill -9` of its own PID. A plain `kill` can leave the main process alive and the relaunch exits silently.

## Webview harness

Webviews are verified in a real browser: stub `vscode`, serve the repository statically in place of `asWebviewUri`, inject a `:root{--vscode-*}` block with the Dark or Light Modern values, and inject an `acquireVsCodeApi` stub under the page's CSP nonce that records `postMessage` calls and answers the startup handshake of the host contract. Drive the page over CDP; `Input.dispatchMouseEvent` modifiers are Alt=1, Ctrl=2, Meta=4, Shift=8, and on a Mac host chords need Meta.

Blind spots of the CDP harness:

- **Text-layer alignment.** Aiming at a span's own bounding box always hits, even when the text layer is misaligned with the ink. Outline `.textLayer span` in a screenshot and assert that the canvas, `.textLayer` and `.annotationLayer` boxes are identical.
- **A perfectly still pointer.** No real hand is. Simulate tremor by moving 1 px every ~40 ms, or timer-reset bugs stay invisible.
- **Pointer resting on content.** Park the idle pointer on a margin with no page content.
- **Text selection.** CDP drags create no text selection; select with a `Range` plus a synthetic `mouseup`.
