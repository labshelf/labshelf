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

The page shows build and install progress itself, because a progress callback cannot cross. It rejects an unknown method or a malformed argument, and the web build reports a rejected call as a helper that is not ready. When the command is missing, every call rejects the same way.

## Helper setup

`labshelf.editorHost.showHelperSetup()` shows the LabShelf Helper setup card in the page's side pane, beside the last PDF rather than in its place. The web build calls it when the helper is not ready or a build reports a missing TeX toolchain. When the command is missing, the web build shows an error message saying this page cannot set up the helper.
