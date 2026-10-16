# VS Code extension

Read when you build, change or verify the VS Code extension.

The full LabShelf workspace inside VS Code:

- a folder tree in the activity bar;
- the paper list and detail pane in an editor tab;
- the PDF reader;
- import with OCR;
- similar-paper indexing;
- Drive sync;
- a Projects view of LaTeX and Typst projects. Opening a project swaps it for that project's Files, Outline and Figures views.

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
- The extension activates on a folder with `labshelf.yaml`, on LaTeX and Typst files, and on startup, so `labshelf:` links work in any workspace. A link such as `labshelf:vaswani2017#p5` in any file (a code comment, a README) opens the reader at that page on Ctrl+click and shows the paper on hover; a key that matches no paper gets no link, and its hover says so. `vscode://<extension id>/open?link=<percent-encoded link>` opens the same link from outside VS Code ([contract](../contracts/links.md)).
- In a project's sources, citation keys complete from the library, show the paper on hover, and open it in the reader on Ctrl+click. `labshelf.bib` is regenerated from the keys the sources cite ([contract](../contracts/library-format.md#labshelfbib)).
- `.bib` files get diagnostics when they open and when they are saved, never while typing, because the preprint check asks arXiv and CrossRef. A repeated entry (same key, DOI or title) is a warning; an article or proceedings paper without a DOI is a hint; a preprint entry (arXiv, bioRxiv, medRxiv) whose published version is recorded gets a warning, only when that relation exists and never from a title guess. Quick fixes: **Replace with the published version** (keeps the key and the entry's own fields), **Remove the second key** for a repeated key, and **Look up the DOI**, which asks CrossRef only when picked. The generated `labshelf.bib` is skipped.
- Typing `\cite[` (Typst: `@key[`) lists the highlights of the cited paper, or of every paper when the citation has no key yet. Picking one inserts its page (`\cite[p.~4]{key}`, Typst `@key[p. 4]`); a second entry per highlight also inserts the quotation before the citation. The completion opens on the `[` character.
- A paper cited by a project lists, in the detail pane's **Cited in** section, each project, file and heading that cites it; a click opens the source at that line. The section is built from the sources of every ready project, and only VS Code fills it ([contract](../contracts/library-ui-host.md)).
- A project's reading list is the papers its sources cite plus those added by hand (`papers:` in `labshelf.yaml`, [contract](../contracts/library-format.md#labshelfyaml)). **Add Paper to Reading List…** (project context menu) picks from the library. Papers opened while the project is active are not added.
- **Install Project Papers** (project context menu, command palette) imports, one by one with a notification, each paper `papers:` lists that the library has under no paper with that cite key, by its DOI through the core network import with the user's own access, under the listed key. A paper already in the library under another key is reported, never renamed; a taken key gets a letter suffix and the summary says so.
- The Library view starts with **Continue** rows: the paper read last, with its page, and the project file edited last, at its cursor. The paper comes from the reading positions in the sidecars; the file comes from each project's device-local `.labshelf/state.json`, which the editor writes on every cursor change ([contract](../contracts/library-format.md#labshelfstatejson)).
- **Show Citation Map** (button in the Library view's title bar) replaces the paper list with the works that at least three of the library's papers cite and the library lacks, with a graph of the papers and those works. Import on a row adds the paper by its DOI. The data comes from OpenAlex and is cached under `.research/openalex/` ([contract](../contracts/library-ui-host.md#citation-map)).
- **Research: Open Project** (project context menu) opens the project's main file and its preview beside it, and the Files view's title bar then offers **Close Project**, which closes the project's source tabs and its preview. The open project is remembered per workspace across reloads. While a project is open, focusing one of its files switches the preview to the PDF of the file's build root and builds that root only when it has no PDF yet.
- The main document is chosen with **Set as Main Document** (explorer context menu on `.tex` and `.typ` files) or from the status bar item. The item appears on the left while the active editor's file belongs to a project, shows the main file, and opens a quick pick on click.
- **Research: Build Project** compiles the active project (LaTeX or Typst), and every save of one of its sources builds it too. A newer request cancels the running compile and queues one fresh build. Errors, warnings and bad boxes appear in the Problems panel in plain language, located in the source file and line, and the next build of the project replaces them.
- **Research: Show Preview** opens the project's built PDF in the LabShelf reader, building it first when it does not exist; **Research: Build Project** opens the preview beside the editor too. Every later build reloads the preview in place and shows its status in the reader's banner; clicking a failed banner opens the build logs of the root it reports. The preview toolbar has **Recompile** for the shown root and two source arrows: PDF-to-code opens the source line behind the point through SyncTeX (so does a double-click), and code-to-PDF scrolls the preview to the editor cursor. The **logs view** lists a root's problems by severity, opens a problem in the source and the raw LaTeX log, and Back to PDF (or Escape) returns to the last PDF that built. **Research: Show in Preview** (`Ctrl+Alt+J`, `Cmd+Alt+J` on macOS, also in the editor's context menu) scrolls the preview to the line under the cursor and marks it. In the preview, hovering a citation (a link, or the text of one) shows the cited paper and clicking it opens the paper in the reader instead of jumping to the bibliography ([contract](../contracts/reader-host.md#preview)). A preview does not save annotations, and its reading position lasts as long as its panel ([contract](../contracts/reader-host.md#preview)).
- Build output goes to `<cache>/labshelf/builds/<project id>/`, so the project folder holds no auxiliary files. The PDF is copied next to the main file only when the build succeeds.
- **Research: Check Before Submitting** (command palette, project context menu) saves, builds the project and checks its PDF and sources for desk-reject causes: the page limit, anonymity, Type 3 fonts, low-resolution images and unresolved references. Findings land in the Problems panel under `labshelf-check`, on the source line when the text traces back to one and otherwise on the PDF, and the next check replaces them. What the check holds the PDF to comes from `check:` in `labshelf.yaml` ([contract](../contracts/library-format.md#labshelfyaml)).
- **Research: Mark Version** (command palette, project context menu) asks for a name (`submitted`, `rebuttal`, `camera-ready` or a free name), builds the project and snapshots its sources and PDF under `.labshelf/versions/` ([contract](../contracts/library-format.md#labshelfversions)). Marking a name that exists asks before replacing it.
- **Research: Compare Versions** (command palette, project context menu) picks a version and what to compare it with: another version or the current build, which it builds first. By default it opens both PDFs in side-by-side readers with the changed regions of each page marked, found by diffing the rendered pages. LaTeX projects on a machine with `latexdiff` can instead build one PDF that marks additions and deletions in the text; it is compiled with the project's toolchain into the build folder under `compare/` and opens in a single reader.
- The compiler item in the status bar and **Research: Choose LaTeX Compiler** pick the engine (`tectonic`, `xelatex`, `pdflatex` or `lualatex`), stored in `labshelf.yaml` ([contract](../contracts/library-format.md#labshelfyaml)). The first build offers an installed TeX Live and otherwise Tectonic. Tectonic 0.17.0 is pinned: after consent it is downloaded, checked against its SHA-256 and installed under the extension's `globalStorage`.
- When LaTeX Workshop is installed, a one-time notice per workspace says it builds on save too and offers to turn that off.
- Typst projects compile in the extension with the WASM compiler and need no install. A preview open beside the editor recompiles while the user types, and a save writes `<main>.pdf` next to the main file. Typst's default fonts (9 MB) are downloaded once, after the first Typst build starts, into `globalStorage`. Packages from Typst Universe are downloaded on demand into the folders the Typst CLI uses, so the extension and the CLI share them. After a successful build `labshelf.yaml` records the Typst version; a project last built with another version gets a warning.
- With a Typst project open and the Tinymist extension missing, a one-time notice per workspace (`labshelf.writing.tinymistOfferShown` in `workspaceState`) offers to install it for completion and errors while typing. When Tinymist is installed, LabShelf pins the project's main file in it.
- LaTeX sources are read across the whole project (the main file and the files it includes). `\ref`, `\eqref` and similar commands complete the project's labels, Ctrl+click goes to the `\label`, and a reference to an undefined label is a warning in the Problems panel. The Outline view of the open project lists the active editor's headings (LaTeX sections, Typst headings), marks the one at the cursor and goes to a heading on click; Typst headings come from LabShelf only when Tinymist is not installed.
- Hovering a formula renders it with MathJax, using the project's `\newcommand` and `\DeclareMathOperator` macros. The status bar shows the word count of the whole project, with the active file's count in its tooltip.
- A project with `figures:` in `labshelf.yaml` lists them in the Figures view of the open project, collapsed, with the count beside the title; the view is hidden when there are none. A row marks a figure that is stale (an input is newer) or missing, its tooltip names the newer inputs and the command, and a click opens the figure. **Research: Regenerate Figure** (inline on a stale row, in the context menu of every row) runs the figure's command in the project folder with progress and live output in an output channel, and a failure offers to show that output. The first run of a command asks for confirmation in a modal; the answer is stored in `workspaceState` for that project and that exact command, so another machine, or a changed command, asks again ([contract](../contracts/library-format.md#labshelfyaml)).
- A project with `values:` reads its JSON leaves in the sources. In LaTeX, `\lsvalue{` completes the keys and hovering a key shows the value, file and path; in Typst, `json("…")` paths and the members after them complete and show the same hover, for files listed under `values:`. Before every LaTeX build the extension writes `labshelf-values.tex` next to the main file and adds `\input{labshelf-values}` to the main file, in the editor when the file is open ([contract](../contracts/library-format.md#labshelf-valuestex)).
- Commands and environments complete from a catalog of core and common-package names. Typing `}` after `\begin{name}`, or pressing Enter right after it, inserts the matching `\end{name}`.

## Adding papers

- **Research: Add Paper by DOI or Link…** takes a DOI, arXiv id, PMID, PMCID or article link. It runs the core network import: metadata from the registries, then the core PDF chain ([architecture.md](../architecture.md)). A paper without a free PDF is saved without one.
- No custom resolver is configured and the registries' contact email is the default, until a setting exists.

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
5. Stop a stuck run by its own process only: keep the PID of the binary you launched (`$!`) and `kill <pid>`, or match its unique flag with `pkill -f -- "--user-data-dir=<SHORT path>"`. Never `pkill`/`killall` by app name (`Code`, `Electron`, `Visual Studio Code`): it matches the user's own windows and closes every one of them.
6. The runner cannot see contributed views. A "Bad progress location" log line is harness noise.

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
