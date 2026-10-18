# Contract: the web build and its editor page

Read when you change a host command of the browser's editor page or the code in LabShelf's web build that calls one.

The browser's editor page hosts LabShelf's VS Code web build in a worker extension host. The page registers host commands in the workbench, and the web build calls them with `vscode.commands.executeCommand`. Arguments and results cross a serialization boundary between the worker and the page: they must be plain JSON, so callbacks never cross and bytes cross as base64 strings.

The web build checks whether a command exists before relying on it. In plain VS Code for the web no page registers these commands, and the web build keeps its own behaviour, described for each command below.

## Library folder

`labshelf.editorHost.libraryFolder()` returns the library folder as an absolute `file:` path (the page answers `/library`). The web build opens that library without asking and does not record it. When the command is missing, the web build asks for a folder with the open dialog. When the command fails or returns something that is not an absolute path, the web build logs the error and asks with the dialog.

## LaTeX helper

`labshelf.editorHost.latexHelper(method, ...args)` runs one method of the page's `ILatexHelper` (LabShelf Helper over native messaging, see [helper.md](helper.md)):

| `method` | Arguments | Result |
|---|---|---|
| `connect` | none | `HelperStatus` |
| `compile` | a project: `{projectId, main, engine, files: [{path, base64}]}` | `{status, problems}`, plus `pdfBase64` when `status` is `succeeded` |
| `cancel` | the project id | none |
| `installTex` | `tinytex` or `texlive` | none |
| `installAllPackages` | none | none |

A progress callback cannot cross, so the extension shows its own build status and the setup card follows its installs itself. The page rejects an unknown method or a malformed argument, and the web build reports a rejected call as a helper that is not ready. When the command is missing, every call rejects the same way.

## Helper setup

`labshelf.editorHost.showHelperSetup()` shows the LabShelf Helper setup card in a panel floating over the page's bottom right corner, which the user can close; the card keeps checking for the helper, and the next request shows the panel again. The page also shows it on opening a LaTeX project when the helper or TeX is missing. The web build calls it when the helper is not ready or a build reports a missing TeX toolchain. When the command is missing, the web build shows an error message saying this page cannot set up the helper.

## Typst compiler

`labshelf.editorHost.typstCompile(request)` compiles a Typst root with the page's compiler (typst.ts, the version `@labshelf/core` pins). The request is `{projectId, main, sources: [{path, text}]}`: `main` and every `path` are relative to the project folder, and `sources` holds the text of the editors open in the project, which shadows the files the page reads from the library. The result is `{status: "succeeded", pdfBase64, problems, cites}` or `{status: "failed", problems}`, with each problem's `file` relative to the project folder and `cites` where the PDF places each citation. The page compiles only the project it opened and rejects any other id or a malformed request.

The web build writes the PDF and drives its own preview as the desktop build does: live compiles while typing write only the preview PDF in the root's build folder, and saved and command builds also write `<root>.pdf`. When the command is missing, every Typst build fails and is logged; a build the user asked for also shows an error.

## pdf.js

The web build's reader loads pdf.js from the extension's `pdfjs/` folder, laid out as the pdfjs-dist package (`build/pdf.min.mjs`, `build/pdf.worker.min.mjs`, `web/pdf_viewer.mjs`, `web/pdf_viewer.css`, and `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/`). The editor page's build copies its vendored pdf.js there. A web host without that folder shows the reader's load error.

## Webviews

The page replaces VS Code's webview host with a copy rewritten for the extension CSP: no inline script and no service worker. Webview resources of a bundled extension load from the extension's copy next to the page; any other resource (a project's PDF, the build folder) comes from the workbench through the host's `load-resource` message, which the content's `fetch` asks for. A Blob worker breaks the extension CSP, so a webview whose worker URL is on its own origin starts the worker directly.
