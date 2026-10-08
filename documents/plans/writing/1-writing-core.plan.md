# Plan: writing in VS Code

Status: draft
Size: GG — a new domain in core (projects, citations, LaTeX build, SyncTeX, Typst in WASM) plus a new VS Code surface and a reader-host contract change; 7 sessions. Grows if the Typst SVG layer needs its own spike session.
Pending decisions: 2

## 1. Goal

A researcher writes a paper in LaTeX or Typst inside VS Code, with LabShelf as the whole environment: one click to create a project, a build that needs no configuration and leaves no clutter, errors that say what to do, a preview in the LabShelf reader, and citations straight from the library. LabShelf replaces LaTeX Workshop for paper writing and works beside Tinymist for Typst.

This plan is the base for [writing-sync](2-writing-sync.plan.md), [writing-browser-bridge](3-writing-browser-bridge.plan.md), [browser-editor](4-browser-editor.plan.md), [writing-terminal](3-writing-terminal.plan.md), [research-links](2-research-links.plan.md) and [submission-tools](2-submission-tools.plan.md).

## 2. Decisions

- [ ] **D1** A project is a folder with a `labshelf.yaml` at its root (format, main file, engine, bibliography file). "New project" creates it under `<library>/projects/<id>/`; "Add existing folder" registers a folder anywhere, for example inside a code repository, without touching its git. — Writing lives with the code, and the library still knows every project.
- [ ] **D2** The registry of external project folders is device-local (`.research/projects.json`, never synced). — Absolute paths differ per machine.
- [ ] **D3** LabShelf replaces LaTeX Workshop: it owns build, preview, errors and the editing features below. Little configuration, opinionated defaults. When LaTeX Workshop is installed, LabShelf says so once and offers to turn off its auto build for the workspace. — The pain is in exactly the parts LaTeX Workshop makes configurable.
- [ ] **D4** On the first LaTeX build, LabShelf asks which toolchain to use: Tectonic (recommended, downloaded on consent into the extension's storage, pinned version, checksum verified) or TeX Live (preselected when `latexmk` is on `PATH`; otherwise a per-OS install guide). The choice is saved in `labshelf.yaml` and shown in the status bar. — Zero-install by default, full TeX Live when the user needs it.
- [ ] **D5** Tectonic runs only XeLaTeX. Choosing pdfLaTeX or LuaLaTeX requires TeX Live; the error says so and links the guide. — An honest limit instead of a silent failure.
- [ ] **D6** Every auxiliary file goes to `<OS cache>/labshelf/builds/<project id>/`. Only `<main>.pdf` lands next to the main file, and only when the build succeeds. — The project folder stays clean; the PDF never disappears on a failed build.
- [ ] **D7** The status bar shows two one-click items: the main file and the compiler. "Set as main document" is also in the explorer context menu. Without a main in `labshelf.yaml`, the file with `\documentclass` is detected. Any build, from any file, builds the main. — Overleaf's model.
- [ ] **D8** Build log lines become diagnostics in the Problems panel in plain language. A missing package says which one and how to install it (`tlmgr install <pkg>` on TeX Live; Tectonic fetches it). — The Overleaf error experience.
- [ ] **D9** The LabShelf reader is the only preview, for both formats. On a failed build it keeps the last good PDF with a banner "Build failed: N errors" that jumps to the first. LaTeX gets SyncTeX in both directions. — One preview with the reader's features everywhere.
- [ ] **D10** LaTeX editing features: `\ref`/`\label` completion, go-to and broken-label warnings; document outline; math preview on hover (with the user's `\newcommand` macros); word count; completion for about 200 common commands and environments; `\begin{x}` closes itself. Not built: formatter (call `latexindent` when installed), linter, snippets beyond the catalog. — The useful 40% of LaTeX Workshop.
- [ ] **D11** Typst editing stays with Tinymist (completion, hover, diagnostics). LabShelf offers to install it when a Typst project opens and passes the main file to it. — Tinymist is good and needs no replacement.
- [ ] **D12** Typst compiles inside the reader webview with `typst.ts` (WASM): a live SVG page layer while typing, about 0.3–0.5 s behind, and PDF export for review. Tinymist's own preview stays available for users who want it instant. — The same code runs in the browser editor later.
- [ ] **D13** LabShelf pins one Typst compiler version per release and records the version in `labshelf.yaml` on build; a mismatch shows a warning. — The same document renders the same in every app.
- [ ] **D14** Citations: completion offers every paper in the library (title, authors, year), not only those already in a `.bib`; hover shows the abstract; Ctrl+click opens the paper in the reader. Choosing a paper adds its entry to `labshelf.bib`, which LabShelf owns and regenerates from the keys the project cites. The user's own `.bib` files stay untouched. — The library is the feature no other tool has.
- [ ] **D15** Review mode: in the reader, hovering a citation in the compiled PDF shows the cited library paper and a click opens it. LaTeX uses hyperref's `cite.<key>` destinations; without hyperref, SyncTeX. — A preview feature only LabShelf can offer.

Open (blocks approval):

- **Q1** Source of the LaTeX command catalog — options: curate it by hand / derive it from LaTeX Workshop's MIT-licensed data with attribution; recommendation: derive, because it is maintained and covers the popular packages.
- **Q2** Project templates in "New project" — options: one blank article per format / also a report and a beamer/touying deck; recommendation: one article per format to start.

## 3. Scope

- **In:** core `writing/` domain, the VS Code Writing view, status bar, language providers, LaTeX build, the reader as preview, Typst in the reader.
- **Out:** sync of projects and collaboration ([writing-sync](2-writing-sync.plan.md)); the browser and terminal; TeXpresso live LaTeX (deferred); AI features; Word and Google Docs beyond copying a formatted citation.
- **Contracts touched:** [library-format.md](../../contracts/library-format.md) (`projects/`, `labshelf.yaml`, `labshelf.bib`, `.research/projects.json`); [reader-host.md](../../contracts/reader-host.md) (preview messages: reload, build status, SyncTeX, citation lookup, page source).

## 4. Acceptance criteria

- [ ] **A1** "New project" in the Writing view creates `<library>/projects/<id>/` with `labshelf.yaml` and a template main file; "Add existing folder" registers a folder and lists it without creating anything but `labshelf.yaml`.
- [ ] **A2** On a machine without TeX, the first build offers Tectonic, downloads it, and produces `main.pdf`; the project folder then holds only the sources, `labshelf.yaml`, `labshelf.bib` and `main.pdf`.
- [ ] **A3** A build with an undefined control sequence shows one Problems entry on the right line in plain words; the reader keeps the previous PDF with the failure banner.
- [ ] **A4** Picking pdfLaTeX while on Tectonic fails with the TeX Live message and the guide link; a missing `.sty` on TeX Live names the package and the `tlmgr` command.
- [ ] **A5** Switching compiler and main is one click each in the status bar and persists in `labshelf.yaml`.
- [ ] **A6** Double-click in the reader jumps to the source line; "Show in preview" scrolls the reader to the cursor.
- [ ] **A7** Typing `\cite{` lists library papers; accepting one inserts the key and adds the entry to `labshelf.bib`; the same works with `@` in Typst.
- [ ] **A8** `\ref{` completes labels, an undefined label is a warning, the outline lists sections, hovering `$\alpha^2$` renders it, and the word count shows in the status bar.
- [ ] **A9** In a Typst project the reader updates while typing, without reloading or losing the scroll position; "Export PDF" writes `main.pdf`.
- [ ] **A10** In review mode, hovering a citation in the PDF shows the library paper; clicking opens it.
- [ ] **A11** With LaTeX Workshop installed, LabShelf shows the duplication notice once per workspace.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| project model, `labshelf.yaml` schema, main detection | `core/src/writing/project/` | neutral; YAML via the core reader rules |
| project registry | `core/src/writing/project/node/` | reads/writes `.research/projects.json` atomically |
| citation scan, `labshelf.bib` generation | `core/src/writing/citations/` | scans `\cite*{}`, `\autocite{}`, `@key` / `#cite(<key>)`; entries from `bib.bib` of each paper |
| LaTeX log parser, label/outline/macro parser, word count, command catalog | `core/src/writing/latex/` | neutral, pure functions with fixture tests |
| toolchain detection, Tectonic download, build runner | `core/src/writing/latex/node/` | spawns `tectonic -X compile --synctex --outdir <cache>` or `latexmk -<engine> -auxdir/-outdir <cache> -synctex=1`; copies the PDF on success |
| SyncTeX reader | `core/src/writing/synctex/` | parses `.synctex.gz` (decompressed by the host) |
| page source port, Typst live layer | `core/src/reader/` + `core/src/reader/dom/` | `PdfPageSource` (pdf.js) and `TypstSvgPageSource` (`typst.ts`); annotations only on PDF |
| Writing view, status bar, commands, providers | `packages/vscode/src/writing/` | CompletionItemProvider, HoverProvider, DefinitionProvider, DocumentSymbolProvider, DiagnosticCollection |
| Tinymist and LaTeX Workshop detection | `packages/vscode/src/writing/` | `vscode.extensions.getExtension` |

`labshelf.yaml`:

```yaml
id: deep-nets-survey
format: latex            # latex | typst
main: main.tex
engine: tectonic         # tectonic | xelatex | pdflatex | lualatex (the last three via latexmk)
bibliography: labshelf.bib
typst: 0.13.1            # written on build, Typst projects only
```

## 6. Sessions and steps

### Session 1 — projects and the Writing view

- **Starts from:** [architecture-refactor.plan.md](../architecture-refactor.plan.md) done; clean tree on a new branch.
- **Ends with:** A1, A5 (main only); the contract updated.
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Project model, `labshelf.yaml`, registry, main detection | — | H · main thread | core tests | [ ] |
| S2 | Writing view, New project, Add existing folder, templates | S1 | M · implementer (sonnet) | A1 | [ ] |
| S3 | Main item in the status bar and explorer menu | S2 | M · implementer (sonnet) | A5 (main) | [ ] |
| S4 | Finish: gate, contract, review | S1–S3 | `finish` skill | gate passes | [ ] |

### Session 2 — citations from the library

- **Starts from:** session 1 committed
- **Ends with:** A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | Citation scan and `labshelf.bib` generation | S1 | H · main thread | core tests | [ ] |
| S6 | Completion, hover, open paper for LaTeX and Typst | S5 | M · implementer (sonnet) | A7 | [ ] |
| S7 | Finish | S5–S6 | `finish` skill | gate passes | [ ] |

### Session 3 — the LaTeX build

- **Starts from:** session 2 committed
- **Ends with:** A2, A3 (diagnostics), A4, A5, A11
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8 | Log parser with plain-language messages | — | H · main thread | fixture tests over real logs | [ ] |
| S9 | Toolchain detection, first-run picker, Tectonic download | S1 | M · implementer (sonnet) | A2 (download) | [ ] |
| S10 | Build runner with cache dir, PDF copy on success, build on save | S8, S9 | H · main thread | A2, A3, A4 | [ ] |
| S11 | Compiler status bar item, LaTeX Workshop notice | S10 | M · implementer (sonnet) | A5, A11 | [ ] |
| S12 | Finish, plus an extension-host run on a sample project | S8–S11 | `finish` + `verify` skills | gate passes | [ ] |

### Session 4 — the reader as preview

- **Starts from:** session 3 committed
- **Ends with:** A3 (banner), A6
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S13 | Reader-host messages: reload keeping position, build status banner | S10 | H · main thread | contract updated, both hosts handle them | [ ] |
| S14 | SyncTeX reader and both directions | S13 | M · implementer (sonnet) | A6 | [ ] |
| S15 | Finish, plus a `verify` run | S13–S14 | `finish` + `verify` skills | gate passes | [ ] |

### Session 5 — LaTeX editing features

- **Starts from:** session 4 committed; Q1 answered
- **Ends with:** A8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S16 | Label, outline and macro parsers; word count | — | M · implementer (sonnet) | core tests | [ ] |
| S17 | Providers: refs, outline, word count | S16 | M · implementer (sonnet) | A8 (refs, outline, count) | [ ] |
| S18 | Math hover with the user's macros | S16 | H · main thread | A8 (math) | [ ] |
| S19 | Command catalog and `\begin` auto-close | Q1 | M · implementer (sonnet) | completion lists catalog items | [ ] |
| S20 | Finish | S16–S19 | `finish` skill | gate passes | [ ] |

### Session 6 — Typst

- **Starts from:** session 5 committed
- **Ends with:** A7 for Typst confirmed, A9
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S21 | Spike: `typst.ts` in the reader webview under the VS Code CSP, fonts, Typst Universe packages fetched by the host | — | H · main thread | a Typst file renders as SVG in the webview | [ ] |
| S22 | Page source port in the reader; SVG live layer; PDF export | S21 | H · main thread | A9 | [ ] |
| S23 | Tinymist detection, install offer, main passed to Tinymist, version pin | S22 | M · implementer (sonnet) | A9, D13 warning | [ ] |
| S24 | Finish, plus a `verify` run | S21–S23 | `finish` + `verify` skills | gate passes | [ ] |

### Session 7 — review mode

- **Starts from:** session 6 committed
- **Ends with:** A10
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S25 | Citation targets in the PDF (hyperref destinations, SyncTeX fallback, Typst links) | S14, S22 | H · main thread | core tests on sample PDFs | [ ] |
| S26 | Reader hover and click for citations in review mode | S25 | M · implementer (sonnet) | A10 | [ ] |
| S27 | Finish, plus a `verify` run | S25–S26 | `finish` + `verify` skills | gate passes | [ ] |

### Step blocks

#### S1 — Project model

- **Do:** schema and parser for `labshelf.yaml` (D1, §5); main detection (first `.tex` with `\documentclass`, else `main.typ`); the device-local registry with add, remove and list; a project id rule reusing the core cite-key slug and collision check.
- **Touch:** `core/src/writing/project/`, `documents/contracts/library-format.md`. **Do not touch:** the sync engine.
- **Done when:** tests cover parsing, unknown keys preserved, detection, and registry writes being atomic.

#### S2 — Writing view

- **Do:** a `labshelf.writing` tree view listing internal and registered projects; actions New project (pick format and template), Add existing folder, Open main, Reveal, Remove from LabShelf (never deletes files).
- **Touch:** `packages/vscode/src/writing/`, `packages/vscode/package.json`.
- **Context:** icons come from the core icon set.

#### S3 — Main in the status bar

- **Do:** a status bar item "main.tex" for the active project, quick pick of candidate files, explorer context menu "Set as main document", written to `labshelf.yaml`.

#### S5 — Citations scan and `labshelf.bib`

- **Do:** scan the project files for citation keys (LaTeX and Typst forms in §5); generate `labshelf.bib` from the library's `bib.bib` entries of the cited keys, in key order, with a first-line comment saying the file is generated; keys missing from the library are left to the user's `.bib`.
- **Done when:** byte-stable output for the same input; tests for each citation form.

#### S6 — Citation providers

- **Do:** completion inside `\cite*{…}` and after `@` in Typst, listing library papers; hover with title, authors, year, abstract; DefinitionProvider opening the paper in the reader; accepting a completion regenerates `labshelf.bib`.
- **Context:** Tinymist also completes keys from the bibliography it sees. LabShelf's items cover the whole library; check which provider wins in Typst and order items so library papers not yet cited are visible.

#### S8 — Log parser

- **Do:** parse TeX and Tectonic logs into `{file, line, severity, message, hint}`: errors (`! …` with `l.<n>`), undefined references and citations, missing files (`File 'x.sty' not found`), overfull boxes as info. Each known error gets a plain-language message and, where it applies, a hint (install command, D5 limit).
- **Done when:** fixture tests from real logs of both toolchains.

#### S9 — Toolchain

- **Do:** detect `latexmk` and the engines on `PATH`; first-run quick pick (D4); download the pinned Tectonic release for the platform from GitHub, verify its checksum, store it in `globalStorage`; per-OS TeX Live guide link.
- **Context:** consent before downloading; no network call without it.

#### S10 — Build runner

- **Do:** run the chosen toolchain with all output in the cache dir (D6), copy `<main>.pdf` next to the main only on success, build on save (debounced, one build at a time, a newer save cancels the running build), publish diagnostics from S8.
- **Done when:** A2–A4 in an extension-host run.

#### S11 — Compiler item and LaTeX Workshop notice

- **Do:** status bar "XeLaTeX (Tectonic) ▾" with the four engines; LaTeX Workshop detection showing the notice once per workspace with a button that writes `latex-workshop.latex.autoBuild.run: never` to workspace settings.

#### S13 — Preview messages

- **Do:** reader-host messages for reload-in-place (keep page and scroll), build status (ok, failed with count, building) and a banner in the reader; bump `PROTOCOL_VERSION`; both hosts handle every message per the contract.
- **Touch:** `core/src/reader/`, `documents/contracts/reader-host.md`, the VS Code and browser hosts.

#### S14 — SyncTeX

- **Do:** parse the SyncTeX file from the cache dir; double-click in the reader opens the source line; command and key "Show in preview" scrolls to the cursor position.

#### S16–S19 — LaTeX editing

- **Do:** parsers for `\label`, `\ref`-family, sectioning and `\newcommand`/`\DeclareMathOperator` across the project's `\input`/`\include` tree; providers per D10; math hover rendered to SVG with MathJax in the extension host; the catalog per Q1 as data in core.

#### S21 — Typst spike

- **Do:** load the `typst.ts` compiler and renderer in the reader webview; confirm CSP (`wasm-unsafe-eval`), bundle size, default fonts, and that the host can fetch Typst Universe packages and hand them over.
- **Done when:** a go/no-go note in §8 with measured render latency on a 10-page document.

#### S22 — Page source and SVG layer

- **Do:** a page source port in the reader; the Typst source compiles in the webview on every change sent by the host (debounced), renders only changed pages, swaps after rendering; "Export PDF" compiles to PDF and writes `main.pdf` through the host.
- **Context:** annotations and text selection stay on the PDF source; the SVG source is for writing.

#### S23 — Tinymist bridge and version pin

- **Do:** install offer when a Typst project opens without Tinymist; pass the main file to Tinymist (verify its setting name in the Tinymist docs); write the compiler version to `labshelf.yaml` and warn on mismatch.

#### S25–S26 — Citations in the PDF

- **Do:** map citation link targets in the compiled PDF to cite keys (hyperref `cite.<key>` named destinations; else SyncTeX to the source `\cite`; Typst: link targets to the bibliography entry); reader hover card and click to open, through a new host message that looks up a key in the library.

## 7. Risks

- **R1** Tectonic lacks a package or feature a template needs. — D5 message and the TeX Live path; log it with the template name.
- **R2** `typst.ts` is heavy in the webview (size, fonts) or lags. — The S21 spike decides; fallback is Tinymist's PDF export plus reload.
- **R3** Citation completion collides with Tinymist's or LaTeX Workshop's. — S6 orders items and the D3 notice covers LaTeX Workshop.
- **R4** Log parsing misses error formats. — Fixture corpus from real logs; unknown errors still show the raw line.

## 8. Log
