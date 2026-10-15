# VS Code extension

Read when you build, change or verify the VS Code extension.

The full LabShelf workspace inside VS Code:

- a folder tree in the activity bar;
- the paper list and detail pane in an editor tab;
- the PDF reader;
- import with OCR;
- similar-paper indexing;
- Drive sync;
- a Writing view of LaTeX and Typst projects.

## Build and run

```bash
pnpm --filter @labshelf/vscode build   # host → out/extension.js, reader → dist/reader/, list → dist/library/
pnpm dev:vscode                        # watches the host and the webview bundles
```

- esbuild bundles the extension host from source, including `@labshelf/*`. Other dependencies (pdf.js, Tesseract, the native canvas) stay external and load from `node_modules`, because they locate their data files and binaries next to themselves. `tsc` only typechecks.

- Open the repository in VS Code and press F5. This launches an Extension Development Host. On first run, use **LabShelf: Configure Library**.
- Drive needs the Desktop OAuth client ([README.md](README.md#google-oauth-clients)). Tokens live in `SecretStorage` under `labshelf.gdrive.tokens`; **LabShelf: Disconnect from Google Drive** clears them.
- The paper list is an in-memory library store rebuilt from the library files on activation. `.research/index.sqlite` holds the embeddings and the content hash of each indexed PDF; deleting it drops them and papers re-index on rebuild.

## Writing projects

- The **Writing** view in the activity bar lists the projects of the library and the external folders added on this device ([contract](../contracts/library-format.md)). **New Project** creates one in the library; **Add Existing Folder as Project** registers any folder; **Remove Project from LabShelf** never deletes files.
- The extension activates on a folder with `labshelf.yaml` and on LaTeX and Typst files. In a project's sources, citation keys complete from the library, show the paper on hover, and open it in the reader on Ctrl+click. `labshelf.bib` is regenerated from the keys the sources cite ([contract](../contracts/library-format.md#labshelfbib)).
- The main document is chosen with **Set as Main Document** (explorer context menu on `.tex` and `.typ` files) or from the status bar item. The item appears on the left while the active editor's file belongs to a project, shows the main file, and opens a quick pick on click.
- **Research: Build Project** compiles the active project (LaTeX or Typst), and every save of one of its sources builds it too. A newer request cancels the running compile and queues one fresh build. Errors, warnings and bad boxes appear in the Problems panel in plain language, located in the source file and line, and the next build of the project replaces them.
- **Research: Show Preview** opens the project's built PDF in the LabShelf reader, building it first when it does not exist; **Research: Build Project** opens the preview beside the editor too. Every later build reloads the preview in place and shows its status in the reader's banner; clicking a failed banner opens the first error in the source. A double-click in the preview opens the source line behind the point through SyncTeX, and **Research: Show in Preview** (`Ctrl+Alt+J`, `Cmd+Alt+J` on macOS, also in the editor's context menu) scrolls the preview to the line under the cursor and marks it. A preview does not save annotations, and its reading position lasts as long as its panel ([contract](../contracts/reader-host.md#preview)).
- Build output goes to `<cache>/labshelf/builds/<project id>/`, so the project folder holds no auxiliary files. The PDF is copied next to the main file only when the build succeeds.
- The compiler item in the status bar and **Research: Choose LaTeX Compiler** pick the engine (`tectonic`, `xelatex`, `pdflatex` or `lualatex`), stored in `labshelf.yaml` ([contract](../contracts/library-format.md#labshelfyaml)). The first build offers an installed TeX Live and otherwise Tectonic. Tectonic 0.17.0 is pinned: after consent it is downloaded, checked against its SHA-256 and installed under the extension's `globalStorage`.
- When LaTeX Workshop is installed, a one-time notice per workspace says it builds on save too and offers to turn that off.
- Typst projects compile in the extension with the WASM compiler and need no install. A preview open beside the editor recompiles while the user types, and a save writes `<main>.pdf` next to the main file. Typst's default fonts (9 MB) are downloaded once, after the first Typst build starts, into `globalStorage`. Packages from Typst Universe are downloaded on demand into the folders the Typst CLI uses, so the extension and the CLI share them. After a successful build `labshelf.yaml` records the Typst version; a project last built with another version gets a warning.
- With a Typst project open and the Tinymist extension missing, a one-time notice per workspace (`labshelf.writing.tinymistOfferShown` in `workspaceState`) offers to install it for completion and errors while typing. When Tinymist is installed, LabShelf pins the project's main file in it.
- LaTeX sources are read across the whole project (the main file and the files it includes). `\ref`, `\eqref` and similar commands complete the project's labels, Ctrl+click goes to the `\label`, and a reference to an undefined label is a warning in the Problems panel. The Outline lists the sections.
- Hovering a formula renders it with MathJax, using the project's `\newcommand` and `\DeclareMathOperator` macros. The status bar shows the word count of the whole project, with the active file's count in its tooltip.
- Commands and environments complete from a catalog of core and common-package names. Typing `}` after `\begin{name}`, or pressing Enter right after it, inserts the matching `\end{name}`.

## Adding papers

- **Research: Add Paper by DOI or Link…** takes a DOI, arXiv id, PMID, PMCID or article link. It runs the core network import: metadata from the registries, then the core PDF chain ([architecture.md](../architecture.md)). A paper without a free PDF is saved without one.
- Sci-Hub is off, and the registries' contact email is the default, until a setting exists.

## Extension host run

Jest mocks `vscode`, and plain Node passes pdf.js's "am I Node?" check, so both hide bugs that appear only in the extension host. The host is an Electron utility process (`process.type === "utility"`), and pdf.js treats it as a browser. Any change to import, OCR, the text layer or pdf.js usage must run in a real host:

1. Create a dummy extension: a `package.json` with `main` and empty `activationEvents`, plus a runner file that exports `run = async () => {…}`. In the runner, `require("vscode")` is real. Require the bundled `out/extension.js` (build first), or bundle the module under test with esbuild.
2. Launch it directly, outside the sandbox. The `code` CLI wrapper detaches, so call the binary:

   ```bash
   env -u ELECTRON_RUN_AS_NODE "/Applications/Visual Studio Code.app/Contents/MacOS/Code" --no-sandbox \
     --user-data-dir=<SHORT path> --extensions-dir=<scratch> --disable-workspace-trust --skip-welcome \
     --skip-release-notes --disable-telemetry --disable-updates \
     --extensionDevelopmentPath=<dummy> --extensionTestsPath=<runner.js> <workspace>
   ```

3. Keep `--user-data-dir` under about 103 characters, because of the IPC socket path limit. The scratchpad path is too long, so symlink it from a short path and delete the symlink after the run.
4. Write runner files with a quoted heredoc (`<<'EOF'`).
5. The runner cannot see contributed views. A "Bad progress location" log line is harness noise.

A cheaper middle ground reproduces pdf.js's environment but not the host lifecycle. Run the script with `ELECTRON_RUN_AS_NODE=1 ".../Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)"`, after setting `process.type = "utility"`.

To test scans, render a real paper's pages to PNG and rebuild an image-only PDF with pdf-lib.

## Webview harness

Webview UI (the reader and the list panel) can only be verified in a real browser:

1. Stub `vscode` through `Module._load`, and bundle and call the HTML builders (the reader shell renderer, the list panel shell) to get the real HTML.
2. Map `asWebviewUri` to a local static server that serves the repository and `pdfjs-dist`.
3. Inject a `:root{--vscode-*}` block with the Dark or Light Modern values.
4. Inject an `acquireVsCodeApi` stub under the page's CSP nonce. The stub records `postMessage` calls and answers the reader's `ready-for-init` with `init`, or the list's `ready` with `navigate` and `snapshot` ([library-ui-host.md](../contracts/library-ui-host.md)).
5. Drive the page over CDP:
   - Click at element centres with `Input.dispatchMouseEvent`.
   - Use modifiers Alt=1, Ctrl=2, Meta=4, Shift=8. `boot.isMac` follows the host, so chords need Meta.
   - Assert on the DOM and on the recorded messages.
   - Read the screenshots. To crop one, use `sips -c H W --cropOffset Y X`.

The CDP harness has known blind spots:

- **Text-layer alignment.** Aiming the pointer at a span's own bounding box always hits, even when the text layer is misaligned with the rendered ink. Outline `.textLayer span` in a screenshot, and assert that the canvas, `.textLayer` and `.annotationLayer` boxes are identical.
- **A perfectly still pointer.** No real hand is perfectly still. Simulate tremor by moving 1 px every ~40 ms, or timer-reset bugs stay invisible.
- **Pointer resting on content.** Park the idle pointer on a margin with no page content.
