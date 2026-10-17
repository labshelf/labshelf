Kept because: decisions D1–D15 and the §8 measurements (Typst compile cost, Tectonic and TeX Live log formats, SyncTeX agreement, how each backend marks citations in its PDF) that the follow-up writing plans build on and no other document holds.
Needed when: starting writing-sync, writing-browser-bridge, browser-editor (the Typst session in the browser), writing-terminal, research-links or submission-tools.

# Plan: writing in VS Code

Status: done
Size: GG — a new domain in core (projects, citations, LaTeX build, SyncTeX, Typst in WASM) plus a new VS Code surface and a reader-host contract change; 7 sessions. Grows if the Typst SVG layer needs its own spike session.
Pending decisions: 0

## 1. Goal

A researcher writes a paper in LaTeX or Typst inside VS Code, with LabShelf as the whole environment: one click to create a project, a build that needs no configuration and leaves no clutter, errors that say what to do, a preview in the LabShelf reader, and citations straight from the library. LabShelf replaces LaTeX Workshop for paper writing and works beside Tinymist for Typst.

This plan is the base for [writing-sync](../contracts/sync.md#conflict-copies), [writing-browser-bridge](../plans/browser-writing-companion/plan.md), [browser-editor](../plans/browser-editor/plan.md), [writing-terminal](../plans/writing-3-writing-terminal/plan.md), research-links and [submission-tools](../plans/writing-2-submission-tools/plan.md).

## 2. Decisions

- [x] **D1** A project is a folder with a `labshelf.yaml` at its root (format, main file, engine, bibliography file). "New project" creates it under `<library>/projects/<id>/`; "Add existing folder" registers a folder anywhere, for example inside a code repository, without touching its git. — Writing lives with the code, and the library still knows every project.
- [x] **D2** The registry of external project folders is device-local (`.research/projects.json`, never synced). — Absolute paths differ per machine.
- [x] **D3** LabShelf replaces LaTeX Workshop: it owns build, preview, errors and the editing features below. Little configuration, opinionated defaults. When LaTeX Workshop is installed, LabShelf says so once and offers to turn off its auto build for the workspace. — The pain is in exactly the parts LaTeX Workshop makes configurable.
- [x] **D4** On the first LaTeX build, LabShelf asks which toolchain to use: Tectonic (recommended, downloaded on consent into the extension's storage, pinned version, checksum verified) or TeX Live (preselected when `latexmk` is on `PATH`; otherwise a per-OS install guide). The choice is saved in `labshelf.yaml` and shown in the status bar. — Zero-install by default, full TeX Live when the user needs it.
- [x] **D5** Tectonic runs only XeLaTeX. Choosing pdfLaTeX or LuaLaTeX requires TeX Live; the error says so and links the guide. — An honest limit instead of a silent failure.
- [x] **D6** Every auxiliary file goes to `<OS cache>/labshelf/builds/<project id>/`. Only `<main>.pdf` lands next to the main file, and only when the build succeeds. — The project folder stays clean; the PDF never disappears on a failed build.
- [x] **D7** The status bar shows two one-click items: the main file and the compiler. "Set as main document" is also in the explorer context menu. Without a main in `labshelf.yaml`, the file with `\documentclass` is detected. Any build, from any file, builds the main. — Overleaf's model.
- [x] **D8** Build log lines become diagnostics in the Problems panel in plain language. A missing package says which one and how to install it (`tlmgr install <pkg>` on TeX Live; Tectonic fetches it). — The Overleaf error experience.
- [x] **D9** The LabShelf reader is the only preview, for both formats. On a failed build it keeps the last good PDF with a banner "Build failed: N errors" that jumps to the first. LaTeX gets SyncTeX in both directions. — One preview with the reader's features everywhere.
- [x] **D10** LaTeX editing features: `\ref`/`\label` completion, go-to and broken-label warnings; document outline; math preview on hover (with the user's `\newcommand` macros); word count; completion for about 200 common commands and environments; `\begin{x}` closes itself. Not built: formatter (call `latexindent` when installed), linter, snippets beyond the catalog. — The useful 40% of LaTeX Workshop.
- [x] **D11** Typst editing stays with Tinymist (completion, hover, diagnostics). LabShelf offers to install it when a Typst project opens and passes the main file to it. — Tinymist is good and needs no replacement.
- [x] **D12** Typst compiles with `typst.ts` (WASM) through a runtime-neutral core session; VS Code runs it in the extension host. While a preview is open, every pause in typing (150 ms) compiles the unsaved text to PDF and the reader swaps it in place; a save or Build Project writes `main.pdf`. No separate SVG layer: the reader keeps text, find, links and hover while writing. Tinymist's own preview stays available. — S21 measured 5–7 ms per PDF compile of 10 pages, so the PDF path costs nothing and keeps every reader feature; the core session runs unchanged in the browser editor later.
- [x] **D13** LabShelf pins one Typst compiler version per release and records the version in `labshelf.yaml` on build; a mismatch shows a warning. — The same document renders the same in every app.
- [x] **D14** Citations: completion offers every paper in the library (title, authors, year), not only those already in a `.bib`; hover shows the abstract; Ctrl+click opens the paper in the reader. Choosing a paper adds its entry to `labshelf.bib`, which LabShelf owns and regenerates from the keys the project cites. The user's own `.bib` files stay untouched. — The library is the feature no other tool has.
- [x] **D15** Review mode: in the reader, hovering a citation in the compiled PDF shows the cited library paper and a click opens it. LaTeX uses hyperref's `cite.<key>` destinations; without hyperref, SyncTeX. — A preview feature only LabShelf can offer.

Answered:

- **Q1** Source of the LaTeX command catalog — derived from LaTeX Workshop's MIT-licensed data, with attribution.
- **Q2** Project templates in "New project" — one blank article per format.

## 3. Scope

- **In:** core `writing/` domain, the VS Code Writing view, status bar, language providers, LaTeX build, the reader as preview, Typst in the reader.
- **Out:** sync of projects and collaboration ([writing-sync](../contracts/sync.md#conflict-copies)); the browser and terminal; TeXpresso live LaTeX (deferred); AI features; Word and Google Docs beyond copying a formatted citation.
- **Contracts touched:** [library-format.md](../contracts/library-format.md) (`projects/`, `labshelf.yaml`, `labshelf.bib`, `.research/projects.json`); [reader-host.md](../contracts/reader-host.md) (preview messages: reload, build status, SyncTeX, citation lookup).

## 4. Acceptance criteria

- [x] **A1** "New project" in the Writing view creates `<library>/projects/<id>/` with `labshelf.yaml` and a template main file; "Add existing folder" registers a folder and lists it without creating anything but `labshelf.yaml`.
- [x] **A2** On a machine without TeX, the first build offers Tectonic, downloads it, and produces `main.pdf`; the project folder then holds only the sources, `labshelf.yaml`, `labshelf.bib` and `main.pdf`.
- [x] **A3** A build with an undefined control sequence shows one Problems entry on the right line in plain words; the reader keeps the previous PDF with the failure banner.
- [x] **A4** Picking pdfLaTeX while on Tectonic fails with the TeX Live message and the guide link; a missing `.sty` on TeX Live names the package and the `tlmgr` command.
- [x] **A5** Switching compiler and main is one click each in the status bar and persists in `labshelf.yaml`.
- [x] **A6** Double-click in the reader jumps to the source line; "Show in preview" scrolls the reader to the cursor.
- [x] **A7** Typing `\cite{` lists library papers; accepting one inserts the key and adds the entry to `labshelf.bib`; the same works with `@` in Typst.
- [x] **A8** `\ref{` completes labels, an undefined label is a warning, the outline lists sections, hovering `$\alpha^2$` renders it, and the word count shows in the status bar.
- [x] **A9** In a Typst project the reader updates while typing, without reloading or losing the scroll position; a save or Build Project writes `main.pdf`.
- [x] **A10** In review mode, hovering a citation in the PDF shows the library paper; clicking opens it.
- [x] **A11** With LaTeX Workshop installed, LabShelf shows the duplication notice once per workspace.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| project model, `labshelf.yaml` schema, main detection | `core/src/writing/project/` | neutral; YAML via the core reader rules |
| project registry | `core/src/writing/project/node/` | reads/writes `.research/projects.json` atomically |
| citation scan, `labshelf.bib` generation | `core/src/writing/citations/` | scans `\cite*{}`, `\autocite{}`, `@key` / `#cite(<key>)`; entries from `bib.bib` of each paper |
| LaTeX log parser, label/outline/macro parser, word count, command catalog | `core/src/writing/latex/` | neutral, pure functions with fixture tests |
| toolchain detection, Tectonic download, build runner | `core/src/writing/latex/node/` | spawns `tectonic -X compile --synctex --outdir <cache>` or `latexmk -<engine> -auxdir/-outdir <cache> -synctex=1`; copies the PDF on success |
| SyncTeX reader | `core/src/writing/synctex/` | parses `.synctex.gz` (decompressed by the host) |
| Typst compile session, pinned version and fonts | `core/src/writing/typst/` (`@labshelf/core/typst`) | `typst.ts` 0.7.0 = Typst 0.14.2; its own entry so `typst.ts` stays out of other bundles |
| Typst file access, fonts store, packages, build | `core/src/writing/typst/node/` (`@labshelf/core/typst/node`) | fonts from the `typst-assets` tag with SHA-256; packages in the Typst CLI's folders |
| Writing view, status bar, commands, providers | `packages/vscode/src/writing/` | CompletionItemProvider, HoverProvider, DefinitionProvider, DocumentSymbolProvider, DiagnosticCollection |
| Tinymist and LaTeX Workshop detection | `packages/vscode/src/writing/` | `vscode.extensions.getExtension` |

`labshelf.yaml`:

```yaml
id: deep-nets-survey
format: latex            # latex | typst
main: main.tex
engine: tectonic         # tectonic | xelatex | pdflatex | lualatex (the last three via latexmk)
bibliography: labshelf.bib
typst: 0.14.2            # written on build, Typst projects only
```

## 6. Sessions and steps

### Session 1 — projects and the Writing view

- **Starts from:** the architecture refactor done (2026-10-15); clean tree on a new branch.
- **Ends with:** A1, A5 (main only); the contract updated.
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Project model, `labshelf.yaml`, registry, main detection | — | H · main thread | core tests | [x] |
| S2 | Writing view, New project, Add existing folder, templates | S1 | M · implementer (sonnet) | A1 | [x] |
| S3 | Main item in the status bar and explorer menu | S2 | M · implementer (sonnet) | A5 (main) | [x] |
| S4 | Finish: gate, contract, review | S1–S3 | `finish` skill | gate passes | [x] |

### Session 2 — citations from the library

- **Starts from:** session 1 committed
- **Ends with:** A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | Citation scan and `labshelf.bib` generation | S1 | H · main thread | core tests | [x] |
| S6 | Completion, hover, open paper for LaTeX and Typst | S5 | M · implementer (sonnet) | A7 | [x] |
| S7 | Finish | S5–S6 | `finish` skill | gate passes | [x] |

### Session 3 — the LaTeX build

- **Starts from:** session 2 committed
- **Ends with:** A2, A3 (diagnostics), A4, A5, A11
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8 | Log parser with plain-language messages | — | H · main thread | fixture tests over real logs | [x] |
| S9 | Toolchain detection, first-run picker, Tectonic download | S1 | M · implementer (sonnet) | A2 (download) | [x] |
| S10 | Build runner with cache dir, PDF copy on success, build on save | S8, S9 | H · main thread | A2, A3, A4 | [x] |
| S11 | Compiler status bar item, LaTeX Workshop notice | S10 | M · implementer (sonnet) | A5, A11 | [x] |
| S12 | Finish, plus an extension-host run on a sample project | S8–S11 | `finish` + `verify` skills | gate passes | [x] |

### Session 4 — the reader as preview

- **Starts from:** session 3 committed
- **Ends with:** A3 (banner), A6
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S13 | Reader-host messages: reload keeping position, build status banner | S10 | H · main thread | contract updated, both hosts handle them | [x] |
| S14 | SyncTeX reader and both directions | S13 | M · implementer (sonnet) | A6 | [x] |
| S15 | Finish, plus a `verify` run | S13–S14 | `finish` + `verify` skills | gate passes | [x] |

### Session 5 — LaTeX editing features

- **Starts from:** session 4 committed; Q1 answered
- **Ends with:** A8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S16 | Label, outline and macro parsers; word count | — | M · implementer (sonnet) | core tests | [x] |
| S17 | Providers: refs, outline, word count | S16 | M · implementer (sonnet) | A8 (refs, outline, count) | [x] |
| S18 | Math hover with the user's macros | S16 | H · main thread | A8 (math) | [x] |
| S19 | Command catalog and `\begin` auto-close | Q1 | M · implementer (sonnet) | completion lists catalog items | [x] |
| S20 | Finish | S16–S19 | `finish` skill | gate passes | [x] |

### Session 6 — Typst

- **Starts from:** session 5 committed
- **Ends with:** A7 for Typst confirmed, A9
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S21 | Spike: `typst.ts` compile cost, fonts, Typst Universe packages | — | H · main thread | go/no-go in §8 | [x] |
| S22 | Core Typst session and Node build; live compile into the preview; build on save and Build Project | S21 | H · main thread | A9 | [x] |
| S23 | Tinymist detection, install offer, main passed to Tinymist, version pin | S22 | M · implementer (sonnet) | A9, D13 warning | [x] |
| S24 | Finish, plus a `verify` run | S21–S23 | `finish` + `verify` skills | gate passes | [x] |

### Session 7 — review mode

- **Starts from:** session 6 committed
- **Ends with:** A10
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S25 | Citation targets in the PDF (hyperref destinations, SyncTeX fallback, Typst links) | S14, S22 | H · main thread | core tests on sample PDFs | [x] |
| S26 | Reader hover and click for citations in review mode | S25 | M · implementer (sonnet) | A10 | [x] |
| S27 | Finish, plus a `verify` run | S25–S26 | `finish` + `verify` skills | gate passes | [x] |
| S28 | Fix research-links before any other writing plan starts | S27 | H · main thread | plan 2 reuses the existing OpenAlex client and the PDF plan's published-version lookup | [x] |

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

- **Do:** measure `typst.ts` compile cost, check fonts and Typst Universe packages, and pick where the compiler runs.
- **Done when:** a go/no-go note in §8 with measured latency on a 10-page document.

#### S22 — Typst build and live preview

- **Do:** core session (`@labshelf/core/typst`) and Node build (`@labshelf/core/typst/node`); VS Code compiles unsaved text into the preview PDF in the build folder while a preview is open, and writes `main.pdf` on save and Build Project. Problems go to the Problems panel unless Tinymist is installed.
- **Context:** D12 as revised by S21; the reader and its protocol do not change.

#### S23 — Tinymist bridge and version pin

- **Do:** install offer when a Typst project opens without Tinymist; pass the main file to Tinymist (verify its setting name in the Tinymist docs); write the compiler version to `labshelf.yaml` and warn on mismatch.

#### S25–S26 — Citations in the PDF

- **Do:** map citation link targets in the compiled PDF to cite keys (hyperref `cite.<key>` named destinations; else SyncTeX to the source `\cite`; Typst: link targets to the bibliography entry); reader hover card and click to open, through a new host message that looks up a key in the library.

#### S28 — Fix research-links

- **Do:** in 2-research-links.plan.md, replace the new `core/src/import/openalex/` with the existing client in `core/src/import/registries/works/openalex.ts`; rewrite its D6 to reuse the published-version lookup that [pdf-finding](../plans/pdf-finding/plan.md) creates (the path is in that plan's §8 log, or in the code once it is merged).

## 7. Risks

- **R1** Tectonic lacks a package or feature a template needs. — D5 message and the TeX Live path; log it with the template name.
- **R2** `typst.ts` is heavy (28 MB WASM in `node_modules`, 9 MB of fonts downloaded once). — Runs in the extension host, never in a webview bundle. System fonts are not loaded: a document naming a font outside Typst's defaults falls back, unlike the Typst CLI.
- **R3** Citation completion collides with Tinymist's or LaTeX Workshop's. — S6 orders items and the D3 notice covers LaTeX Workshop.
- **R4** Log parsing misses error formats. — Fixture corpus from real logs; unknown errors still show the raw line.

## 8. Log

- 2026-10-15 17:05 — Base is `feat/reader-ux` (72b3dc0), not `main`: `main` is 194 commits behind and lacks this plan and the contracts. Q1: derive the catalog from LaTeX Workshop; Q2: one article per format. S28 added at the user's request.
- 2026-10-15 17:15 — Contract: `projects/`, `labshelf.yaml` and `.research/projects.json` in library-format.md, in its own commit (905f9de).
- 2026-10-15 17:20 — S1: `core/src/writing/project/` and `node/`; project ids keep hyphens (`projectIdSlug`) with the cite-key collision suffixes; a corrupt registry or `labshelf.yaml` is never rewritten; templates carry no bibliography line until the first citation (S5/S6 adds it). 64 tests (e3331f2).
- 2026-10-15 17:35 — S2/S3: `packages/vscode/src/writing/`; the active project is the one owning the active editor's file; tree icons are ThemeIcons, like the Library view. A5 holds for the main item only; the compiler item is S11.
- 2026-10-15 17:40 — S4: finish gate passes (core 1955, vscode 302 tests); extension-host run confirms A1 and the main item and Set as Main Document.
- 2026-10-15 18:10 — Session 2 runs in the `labshelf-writing-core` worktree, where session 1 is committed.
- 2026-10-15 18:25 — S5: `core/src/writing/citations/` and `node/`. Entries come from `bibtexEntry(record, {includeFile: false})`, not from each `bib.bib`: the same text without the library path. Keys match `citeKey` case-sensitively; on a duplicate key the smallest id wins. The bibliography line goes into the main file with the first resolved citation (Typst: only when no other `#bibliography` exists, else a conflict for the user). An `OpenSources` port lets the host supply unsaved text and edit an open main file in the editor. 33 tests.
- 2026-10-15 18:45 — S6: `packages/vscode/src/writing/citations/`. Ctrl+click is a DocumentLink to `labshelf.openPdfViewer`, not a DefinitionProvider, which must return a source location. Library items carry `sortText` "0…" to lead other providers. The extension activates on `workspaceContains:**/labshelf.yaml`, `onLanguage:latex` and `onLanguage:typst`. Key positions and the completion context moved into core (`citedKeys`, `partialKeyStart`), so the app holds no copy of the regexes. `bibliography:` is recorded only once the main loads the file, so a Typst conflict is retried.
- 2026-10-15 19:05 — S7: finish gate passes (core 2012, vscode 326 tests); contract gains `labshelf.bib`. The extension host confirms A7 for LaTeX and Typst: completion, accept, `labshelf.bib`, the main line in the unsaved editor, `labshelf.yaml`, the reader link, and shrinking on save. Not checked: ordering beside Tinymist, real keystroke auto-trigger.
- 2026-10-15 18:25 — Session 3 runs in the `labshelf-writing-core` worktree. Wall-clock times from here are the system clock; earlier lines ran ahead of it.
- 2026-10-15 18:25 — S8: `core/src/writing/latex/log/` (`readTexLog` → `explainTexMessage` → `parseTexLog`). Fixtures are real logs: Tectonic 0.17.0 and TeX Live 2026 `latexmk -file-line-error` (Docker `texlive/texlive:latest-medium`), 6 cases each. Tectonic halts at the first error and names `\input` files without extension; TeX Live keeps going and follows a fatal error with "Emergency stop", which is dropped when a cause exists. Unknown messages keep TeX's words (R4).
- 2026-10-15 18:25 — S9: Tectonic 0.17.0 pinned with SHA-256 per platform (macOS, Linux musl, Windows msvc); installed under `<globalStorage>/tectonic/0.17.0/` on consent, hash checked before extraction with the system `tar`. A first-run pick of TeX Live writes `engine: pdflatex`. Real download verified on darwin-arm64 only.
- 2026-10-15 18:25 — S10: `core/src/writing/latex/build/` (command line) and `node/` (cancellable run that kills the process tree, problem locating, PDF copied atomically on success). `cacheDir` moved from the terminal to `core/src/library/node`. VS Code: `writing/build/` queues one build per project, a newer save cancels the running one, and a dismissed toolchain prompt stops save builds from asking until Build Project runs.
- 2026-10-15 18:25 — S11: compiler item at priority 49 with `labshelf.writing.pickCompiler`; LaTeX Workshop notice once per workspace (`workspaceState`), button writes `latex-workshop.latex.autoBuild.run: never`. Toolchain files grouped in `writing/build/toolchain/`.
- 2026-10-15 18:25 — S12: finish gate passes (core 2056, vscode 361, terminal 862); `documents/apps/vscode.md` gains the build. The extension host confirms A2, A3 (Problems entry; the banner is S13), A4 first half, A5 and A11 (with a stand-in LaTeX Workshop). A4 second half confirmed by a real `latexmk` build. Not checked: the TeX Live guide link opening, the Turn off button's setting write in a real host, Windows and Linux Tectonic installs.
- 2026-10-15 19:28 — Session 4 runs in the `labshelf-writing-core` worktree.
- 2026-10-15 19:28 — S13: `PROTOCOL_VERSION` 2 with `reloadDocument`, `buildStatus`, `revealPoint`, `showBuildProblem`, `showSource` and `ReaderBootParams.preview`; S14's messages are part of the same bump. The controller holds the latest message of each type until `ready` (replaces `pendingPage`); optional `preview` ports, logged and ignored where absent (browser). The reader swaps the pdf.js document in place (`DocumentReloader`, `DOCUMENT_REPLACED`), not a webview re-render: no flash, sidebar and find survive; outline, thumbnails, page total and hover caches reset on the event. VS Code: `ReaderPanel` shared by library papers and previews; previews use an in-memory store that refuses annotations with a notice; Build Project opens the preview beside the editor, saves only update an open one; a preview opened later shows the last failed or running build.
- 2026-10-15 19:28 — S14: `core/src/writing/synctex/` and `node/`, cross-checked against the `synctex` CLI on a real pdfTeX build (46 of 47 inverse points, 16 of 16 forward lines). Double-click to source only in previews; Show in Preview on `ctrl/cmd+alt+j`, which is also LaTeX Workshop's key (D3 notice covers that); revealing an open preview keeps editor focus.
- 2026-10-15 19:28 — S15: finish gate passes (core 2117, vscode 392, browser 124). The extension host confirms A3 (banner, click to the error, clears on fix) and A6 both ways, plus in-place reload keeping scroll and zoom over three saves and outline, thumbnails and page total growing. Open: `lint:deps` reports 28 Node imports outside `node/` folders in `vscode/src/writing/` (22 from sessions 1–3, 6 from this one) — needs a move into `writing/node/` or a rule exception for the domain; two jscpd clones (`projectFolder.ts`/`projectRegistryFile.ts`, `tokens.css`). Not checked: Tectonic and XeTeX/LuaTeX SyncTeX, the banner's no-wrap CSS fix on screen, webview errors at first open.
- 2026-10-15 20:16 — Session 5 runs in the `labshelf-writing-core` worktree.
- 2026-10-15 20:16 — S16: `core/src/writing/latex/source/` (`scanLatexSource`, `collectProjectSources` over an async `ProjectSourceReader`, `undefinedRefs`, `macrosToMathJax`, `countWords`). Includes resolve from the project root, as LaTeX does; a file reached twice is scanned once, which also guards cycles. Labels known only through `\externaldocument` show as undefined (TRAP in core). 32 tests.
- 2026-10-15 20:16 — S17: `vscode/src/writing/latexEditing/` `project/` (open editors first, then disk; cache per project), `labels/` (completion, go-to, `labshelf-labels` warnings), `outline/`, `wordCount/` (whole include tree, priority 48, active file in the tooltip). 29 tests.
- 2026-10-15 20:16 — S18: `core/src/writing/latex/math/` with `mathjax-full` 3.2.2 (bundles statically; v4 loads fonts at run time). It is the `@labshelf/core/math` entry, not in the root barrel: from the root, MathJax (about 2.5 MB of CommonJS with import-time side effects) landed in every browser and webview bundle. Parse errors show TeX's message; unknown commands keep MathJax's red name, recoloured with the error token. Hover with project macros, or the file's own outside a project.
- 2026-10-15 20:16 — S19: `core/src/writing/latex/catalog/` (about 205 commands and 50 environments from LaTeX Workshop's data; MIT notice as a `/*! */` comment in its index, kept by esbuild) and `latexEditing/commands/`. Auto-close fires on `}` and on Enter after `\begin{x}`: with VS Code's default bracket pairing, typing `}` overtypes and changes no text.
- 2026-10-15 20:16 — S20: finish gate passes (core 2175, vscode 447); architecture.md gains the `math` entry, apps/vscode.md the editing features. The extension host confirms A8 in full (ref completion and go-to across files, the warning, nested outline, α² and ℝⁿ hovers in Dark Modern, word count, catalog, `\end` on Enter). Not checked: light theme hover colours, a run repeated after the clean one, the browser and terminal gates, the session-4 `lint:deps` item.
- 2026-10-15 20:20 — Session 6 runs in the `labshelf-writing-core` worktree.
- 2026-10-15 20:58 — S21: go. `typst.ts` 0.7.0 bundles Typst 0.14.2; a 10-page PDF compiles in 5–7 ms per edit (Node, warm), 74 ms cold in the extension host. The 28 MB compiler WASM embeds no fonts, so Typst's 17 default text fonts (9 MB) come from the `typst-assets` v0.14.2 tag with pinned SHA-256s. The reader is pdf.js throughout (find, selection, links, hover, outline, SyncTeX), so D12 is revised: compile to PDF in the extension host and reuse the in-place reload; no SVG layer, no page source port, no protocol change. Jest needs `--experimental-vm-modules` for typst.ts's dynamic import of its ESM compiler package.
- 2026-10-15 20:58 — S22: `core/src/writing/typst/` (`@labshelf/core/typst`: session, pins, problems; hints dropped) and `node/` (`@labshelf/core/typst/node`: sync file access, fonts store, packages in the Typst CLI's data and cache folders with name/version checks before any path is built, `runTypstBuild` that downloads missing Universe packages and compiles once more). `latexBuildDir` became `projectBuildDir` in `project/node`. VS Code: `writing/typst/` compiles unsaved text 150 ms after typing pauses into the build-folder PDF while a preview is open; a failed live compile leaves preview and banner alone; save and Build Project write `main.pdf` too. `registerBuildCommand` dispatches by format. Typst previews answer double-click with a message instead of SyncTeX.
- 2026-10-15 20:58 — S23: `writing/typst/tinymist/` offers Tinymist once per workspace and pins the main through the server's `tinymist.pinMain` (takes a path, writes no settings); Typst problems go to the Problems panel only without Tinymist. `typstVersionPin.ts` writes `typst:` after a successful build and warns once per project on a different recorded version.
- 2026-10-15 20:58 — S24: finish gate passes (core 2219, vscode 497); architecture.md gains both entries, apps/vscode.md the Typst build, library-format.md the `typst:` write. The extension host confirms A9 (unsaved edits in the preview about 200 ms after the last key, scroll and webview kept, `main.pdf` unchanged until save; error unsaved keeps the last PDF, saved shows Problems and banner, fix clears), A7 for Typst, package download, the version write, the Tinymist offer and a pin without error (Tinymist 0.15.8). Not checked: that Tinymist's main actually changed, live preview beside Tinymist's diagnostics, offline font download, Windows paths, system fonts (R2).
- 2026-10-15 21:00 — Session 7 runs in the `labshelf-writing-core` worktree.
- 2026-10-15 21:15 — S25: real PDFs decide the route per backend. pdfTeX with hyperref names each citation link `cite.<key>` (biblatex `cite.<n>@<key>`), with no entry in `getDestinations()`. A Typst PDF carries no key: citation links are explicit destinations to the bibliography entry. So the Typst session compiles a second, shadow-only probe after each successful compile: the probe includes the main file and queries every `cite` with its key and position (pt, from the top-left). The probe's PDF is byte-identical to the main's, a positioned citation starts at its link rectangle's left edge, and a `set document` rule in the main still compiles. LaTeX without hyperref goes through SyncTeX to the keys on the source line. `writing/review/` (`citedKeysAt`, `citationEntries`), `papersByCiteKey` taken out of `bibliographyFile`, `typstCitationProbe`; protocol 3 with `lookupCitation`/`citation`/`openCitedPaper` in `previewProtocol.ts`; the host always answers a lookup. Sample-PDF tests read link annotations with real pdf.js in a child process, because Jest maps pdf.js to a mock.
- 2026-10-15 21:20 — S26: reader `dom/hover/citations/` (lookup client with a 1.5 s timeout and a per-document cache, card, capture-phase click that opens the paper or replays the click for pdf.js); VS Code `writing/preview/citations/`, with the Typst positions of the last successful build kept beside the preview. The card's header reads "Cited paper", and the title moves into the body because headers are uppercase labels.
- 2026-10-15 21:30 — S27: finish gate passes (core 2269, vscode 509, browser 124, terminal 862); apps/vscode.md gains review mode. The extension host confirms A10 for LaTeX with hyperref, Typst, and LaTeX without hyperref (card through SyncTeX): hover card, click opens the paper, and section and bibliography links keep their preview and jump. Not checked: biblatex's `cite.<n>@<key>` in a real build; one first Typst hover without a card that did not happen again. Open: `reader.css` is at 295 lines, and splitting it changes how both apps load it; Build Project on a fresh project does not write `labshelf.bib` until a source is saved.
- 2026-10-15 21:30 — S28: research-links extends the existing OpenAlex client (works by DOI) and its `RegistryEnv`, and its linter calls pdf-finding's published-version lookup. That lookup is pdf-finding's S21, not built yet, so research-links S8 depends on it.
