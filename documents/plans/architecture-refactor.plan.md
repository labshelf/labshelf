# Plan: architecture refactor

Status: in progress (session 8 of 13)
Size: GG — every package moves and duplicated logic merges across three apps; 13 sessions, one per phase (phases 4 and 9 are the heaviest).
Pending decisions: 4

## 1. Goal

Bring the code to [architecture.md](../architecture.md) and the rules in [AGENTS.md](../../AGENTS.md):

- four packages (`core`, `vscode`, `browser`, `terminal`);
- shared logic exists once, in core;
- the three apps share one look;
- every file has one job and fits the size limits;
- no dead code is left.

When this plan is done, delete it and the note at the top of `architecture.md`.

## 2. Decisions

- [ ] **D1** The target layout is the one in `architecture.md`: four packages, and core holds everything more than one app can use. — Without it, shared code ends up copied per app.
- [ ] **D2** Core is split by domain, with `node/` and `dom/` runtime folders and three entry points (`@labshelf/core`, `/node`, `/dom`). — Code shared by VS Code and the terminal is often Node-only, and code shared by the webviews and the browser is DOM-only.
- [ ] **D3** Every app consumes core from source through its `exports` map. The VS Code extension host is bundled with esbuild, and core has no `dist`. — This removes stale-build bugs and double bundling.
- [ ] **D4** The mechanical checks (ESLint size limits, dependency-cruiser boundaries, knip) start as warnings on existing code and become errors in S11.3. — The rules are enforced without blocking work midway.
- [ ] **D5** When copies merge, the base is the most complete copy:
  - terminal search language and sync service;
  - terminal PKCE auth;
  - browser library-page components;
  - browser `tokens.css`.

  Each difference between copies is decided explicitly, never silently.
- [ ] **D6** One step is one commit, and every step leaves `pnpm -r typecheck` and `pnpm -r test` green. — Each step stays reviewable and reversible.
- [ ] **D7** Behaviour stays the same except for these listed changes:
  - **BC1** the browser reads `metadata.yaml` with core rules (S3.3);
  - **BC2** VS Code import avoids cite-key collisions (S3.4);
  - **BC3** the browser follows the owned-fields and status-on-disk rules (S4.2);
  - **BC4** one search language in every app (S4.4);
  - **BC5** one author format (S4.5).
  - **BC6** one folder-name rule in every app: no empty name, slash, leading dot, control character or name over 255 characters (S3.4);
  - **BC7** the browser normalises tags on capture like the other apps (S3.4);
  - **BC8** VS Code skips a `metadata.yaml` whose top level is not a mapping (S3.3);
  - **BC9** VS Code import slugs the file stem when no cite key is found (S3.4);
  - **BC10** the VS Code log appends and rotates to `app.log.1` at 2 MiB (S3.6);
  - **BC11** VS Code writes files atomically, through a temp file and a rename (S3.7);
  - **BC12** VS Code sync skips deleting a local file that is already gone (S3.7).
  - **BC13** VS Code import skips a PDF whose DOI is already in the library, as the terminal does (S4.2);
  - **BC14** one import summary in the terminal wording: `Added "<title>" — metadata unconfirmed, check it`, `N added, N already in the library, N failed: <first error>` (S4.1);
  - **BC15** moving a folder into the folder it is already in does nothing, with no error (S4.1);
  - **BC16** VS Code shows and logs a failed trash, and the paper stays in the list (S4.2);
  - **BC17** a name collision on a move or rename says `"<name>" already exists there` in every app (S4.1);
  - **BC18** the import folder walk skips dot entries, sorts the paths and logs folders it cannot read (S4.1);
  - **BC19** symlinks are not followed: a symlinked PDF or folder is skipped on import, and a symlinked `paper.pdf` counts as no PDF (S4.1).
  - **BC20** VS Code has one import flow for every entry point: each offers the metadata lookup for unconfirmed papers, an empty import says `No PDF found there`, and a picked non-PDF file fails with `Not a PDF file` (S4.2);
  - **BC21** the terminal `add` command prints `skipped <input>` and exits 1 for a skipped input (S4.2);
  - **BC22** the browser background `paper.remove` reports a failed delete instead of claiming success (S4.2).
  - **BC23** one paper sort order: status Unread → Reading → Done, author by family name ("Last, First" too), numeric collation for titles and folders, papers without a year last in both directions (S4.3);
  - **BC24** one scan rule: dot entries are skipped, a folder holding only `paper.pdf` is not a paper, a symlinked file or folder counts as absent, and on a duplicate id the first folder in path order wins and the others are logged (S4.3);
  - **BC25** VS Code drops a paper from its index when its folder leaves the disk (S4.3);
  - **BC26** relative times read `just now`, `5m ago`, `3h ago`, `yesterday`, `4d ago`, `2w ago`, `Mar 4`, `Mar 2024` in every app; the terminal keeps `never` for no date (S4.5);
  - **BC27** a DOI stored as a `doi.org` URL links once, not doubled (S4.5);
  - **BC28** the VS Code watcher also ignores editor backups (`~`) and swap files (`.swp`) (S4.6).
  - **BC29** a failed run-record write is logged and never fails a sync (S5.1);
  - **BC30** after a sync, apps reload only when the `library` namespace changed; an appdata-only download does not reload the terminal (S5.1);
  - **BC31** a browser sync requested while one runs joins it, and a sync while signed out returns a skipped outcome instead of throwing; VS Code logs sync failures (S5.1);
  - **BC32** VS Code signs in with the terminal's PKCE flow: state check, `prompt=consent`, a 5-minute timeout, an error when Google returns no refresh token, `invalid_grant` clears the tokens and asks to sign in again, and the `LABSHELF_GOOGLE_CLIENT_ID`/`_SECRET` override; token refresh is single-flight. Stored tokens stay valid (S5.2).
  - **BC33** one DOI cleanup for every source (PDF text, links and XMP, browser pages, typed queries): `?query`, `#fragment`, a `.pdf` extension and publisher tails (`/abstract`, `/full`, `/pdf`) are dropped, percent-encoding is decoded, and trailing punctuation is stripped while balanced brackets stay; each source keeps its own scan rules (S6.1);
  - **BC34** typed or pasted input in VS Code Fetch Metadata and terminal add/import recognises the same identifiers: a bare arXiv id, a bare DOI, arXiv `/abs`, `/pdf` and `/html` URLs and PubMed URLs (S6.1).
  - **BC35** one publication-year rule (`extractYear`: the first 19xx or 20xx, also inside a compact date such as `20230115`) for PDFs, registries and landing pages (S6.2);
  - **BC36** the title-agreement check takes an author's surname with the core family-name rule, so "Ibarra, Oscar H." gives "ibarra" (S6.2);
  - **BC37** the terminal imports a landing-page URL: it reads the page, resolves metadata, skips a paper the library already has (DOI, arXiv id or title and year, as the browser does), downloads the first PDF link that is a PDF, and otherwise saves the paper without a PDF (S6.2).
  - **BC38** the PDF chain in every app also asks OpenAlex, Semantic Scholar and Europe PMC for identifiers and open copies and reads PMC's open-data bucket; a copy they suggest counts only if `sameWork` matches its title. The order is: the page's own link, arXiv, the three lookups, arXiv again for an id they learned, PMC, publisher, CrossRef, Unpaywall, Sci-Hub. The PubMed resolver is gone, because metadata resolution already supplies the DOI. "Find PDF" for a saved paper compares against its record (S6.3);
  - **BC39** one PDF download rule: `%PDF-` within the first 1 KiB, a 200 MB cap, a 45 s timeout and up to 3 interstitial hops; the terminal follows interstitials and logs bot checks too (S6.3);
  - **BC40** arXiv URLs and DOIs with old-style ids (`hep-th/9711200`) are recognised (S6.3);
  - **BC41** a terminal import by DOI, PMID, PMCID or arXiv id finds the PDF through the chain, and VS Code gains "Add Paper by DOI or Link…" on the same import; Sci-Hub is off and the contact email is the default until a setting exists (S6.3).
  - **BC42** pdf.js for Node runs with `verbosity: 0` and `isEvalSupported: false` in VS Code as in the terminal, so the extension host no longer prints pdf.js warnings (S6.5).

Open questions (each one blocks only the steps named):

- **Q1** (blocks S10.5) Keep the SQLite paper index in VS Code, or use the in-memory library store from S4.3 as the terminal does?
  - Answer: in-memory. The index is a cache rebuilt on every activation, and dropping it removes `IResearchDatabase`, the column migrations and a whole layer. SQLite stays only for the AI stores. It also keeps the extension close to running as a web extension, which the writing workflow needs.
- **Q2** (blocks S1.6, S6.3) The four unwired resolvers (OpenAlex, Semantic Scholar, Europe PMC, PMC) belong to [pdf-finding.plan.md](pdf-finding.plan.md).
  - Options: wire them in during S6.3 / delete them.
  - Answer: wire them in during S6.3, with `titleMatch.ts`. pdf-finding.plan.md is active and puts its resolver steps in S6.3; its proxy and author-request steps stay in that plan.
- **Q3** (blocks S1.3) About a third of the AI package has no consumer: `analysis/`, claims, term novelty, MMR, the sliding chunker.
  - Options: delete / keep.
  - Recommendation: delete, and rebuild when a feature needs it.
- **Q4** (blocks S1.5) The five placeholder sidebar views (Writing, Reading, Insights, Assist, Agents).
  - Options: delete / keep.
  - Recommendation: delete. They are mock-ups.
- **Q5** (blocks S1.5) The data migrations `migrateSidecars`, `STALE_PDF_FAILURE`, `relaxChunkTextConstraint` and `ensureColumns`. Is every library you use already migrated?
  - Options: yes, delete them / no, keep them.
  - Recommendation: if yes, delete. If no, keep them under `migrations/`, each with its deletion condition.
- **Q6** (blocks S4.5) The author format for two authors.
  - Answer: "A & B", the citation convention (VS Code and the reader today; the browser and the terminal write "A, B").
- **Q7** (blocks S1.8) The ONNX embeddings never run, because `@xenova/transformers` is not a dependency.
  - Options: add the dependency / remove the ONNX path and the model download.
  - Recommendation: remove it, unless the AI features are in active use. The hash fallback is what runs today.

## 3. Scope

- **In:** every package in `packages/`, the build scripts, the jest configs, `documents/` paths, and the bugs found while mapping (B1–B6).
- **Out:** new features. Exception: the unwired resolvers, if Q2 says to wire them in.
- **Contracts touched:** none change. [library-format.md](../contracts/library-format.md) and [sync.md](../contracts/sync.md) must keep holding; S5.3 verifies the browser against the sync contract.

## 4. Acceptance criteria

- [x] **A1** `packages/` holds exactly `core`, `vscode`, `browser` and `terminal`. Each app depends only on `@labshelf/core` among workspace packages.
- [ ] **A2** dependency-cruiser runs as an error and passes:
  - no app imports another;
  - core imports no app;
  - neutral core imports no `node/` or `dom/` code, `node:*` or DOM;
  - no import goes past another directory's `index.ts`;
  - VS Code imports `node:*` and Node-only packages only from its `node/` folders.
- [ ] **A3** knip runs as an error and reports no unused file, export or dependency.
- [ ] **A4** ESLint runs as an error and passes: no source file over 300 lines, no test file over 500, no function over 50 lines. No directory holds more than 8 source files.
- [ ] **A5** Each of these exists once, in core: the library mutations (one service instead of three), the `metadata.yaml` reader, the cite-key, tag and folder-name helpers, search, author formatting, shared config, the file logger, the Node file system, the lock store, PKCE auth, the sync coordinator, identifier detection, the PDF resolver chain, the reader host controller, the sidecar store, the design tokens, the icon set and the library UI.
- [ ] **A6** The VS Code list panel and the browser library page render the same library alike, in dark and light. Screenshots are compared in S9.5.
- [x] **A7** `pnpm -r typecheck` and `pnpm -r test` pass. Core runs its own test suite.
- [ ] **A8** B1–B6 each have a regression test that fails before the fix.
- [ ] **A9** The `health` skill reports no `@depends`/`@dependents`/`@usedBy` tags and no history language in comments.
- [ ] **A10** Behaviour visible to the user changes only as listed in D7. Each listed change is covered by a test.

## 5. Design

The target structure is in [architecture.md](../architecture.md). How the work proceeds:

- **Every step:** touch only the files the step names, plus their importers and tests. Delete moved or replaced code in the same step; no re-exports, aliases or shims for old paths. Tests move with their code. Fix the docs the step makes wrong.
- **Before deleting:** search the whole repo for the symbol and the path, including manifests, `package.json` contributions, HTML and build scripts.
- **How a step runs:** the `refactor-step` skill. `code-mapper` (Sonnet) maps the step, and the main model takes only the behaviour decisions and the splits that need design. `module-splitter` or `dead-code-cleaner` (Sonnet) does the move or deletion, and `finish` (Sonnet) closes it.

Starting point, mapped on 2026-10-08 on branch `feat/reader-ux`:

| Area | State |
|---|---|
| Packages | `latex` is an empty stub. `ai` is used only by VS Code, and about a third of it is unused. `reader` contains VS Code-only code (`main.ts`, `createVsCodeTransport`). |
| Duplication | VS Code `PaperService` (698 lines) and terminal `TerminalPaperService` (619) do the same job. The cite-key, tag, folder-name and title helpers are copied and already diverge. Three `metadata.yaml` parsers, three search languages, three sort orders and three author formatters exist. PKCE auth, `NodeLockStore`, shared config, the file logger and the pdf.js Node loader are copied between VS Code and the terminal. The reader host dispatch exists twice. VS Code re-implements the reader's `PaperDataStore`. |
| Visual | Three token systems (`--vscode-*` used directly, `--ls-*`, `--rd-*`) and three icon sets. The highlight colours disagree. The VS Code list webview is about 2,800 lines of untyped string templates; the browser library page is a hand-ported copy of it. |
| Size | 24 source files are over 300 lines: terminal `ui/app.ts` 1,613, vscode `core/paperService.ts` 698, `ui/list/template.script.ts` 692, `extension.ts` 669. |
| Build | VS Code and the browser consume core from `dist`, the terminal from source. The browser bundles the reader's shared code twice. Core's tests live in `packages/vscode/__tests__`. |

## 6. Sessions and steps

Every session starts from a clean tree on the plan's branch, which is the state the previous session ends in. It ends with typecheck and tests green and one commit per step. Runner tiers:

- **H**: the session model;
- **M**: Sonnet;
- **L**: Haiku;
- **user**: you.

### Session 1 — guard rails

- **Starts from:** the current working tree (uncommitted).
- **Ends with:** everything committed, core with its own tests, core consumed from source, the checks running as warnings.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S0.1 | Commit the working tree | — | user · `commit-splitter` (L) | clean tree | [x] |
| S0.2 | Core gets its own test suite | S0.1 | M · module-splitter | A7 for core | [x] |
| S0.3 | Consume core from source; VS Code host on esbuild | S0.2 | H · main thread | builds and tests green, extension host run passes | [x] |
| S0.4 | Add ESLint, dependency-cruiser, knip, runtime tsconfigs (warnings) | S0.3 | M · implementer | checks run in `pnpm -r lint` | [x] |
| S0.5 | Fix root scripts, drop `coverage/` | S0.1 | L · implementer (haiku) | `pnpm dev:vscode` resolves | [x] |

### Session 2 — dead code and quick bugs

- **Starts from:** session 1 committed. Q3, Q4, Q5 and Q7 answered; Q2 is needed for S1.6.
- **Ends with:** the dead code listed below gone, and B1, B4 and B5 fixed with tests.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1.1 | Delete `packages/latex` | S0.4 | M · dead-code-cleaner | A1 (partly) | [x] |
| S1.2 | Core dead code | S0.4 | M · dead-code-cleaner | knip clean for core | [x] |
| S1.3 | AI dead code | S0.4, Q3 | M · dead-code-cleaner | knip clean for ai | [x] |
| S1.4 | Reader dead code | S0.4 | M · dead-code-cleaner | knip clean for reader | [x] |
| S1.5 | VS Code dead code | S0.4, Q4, Q5 | M · dead-code-cleaner | knip clean for vscode | [x] |
| S1.6 | Browser dead code | S0.4, Q2 | M · dead-code-cleaner | knip clean for browser | [x] |
| S1.7 | Terminal dead code | S0.4 | M · dead-code-cleaner | knip clean for terminal | [x] |
| S1.8 | Fix B1, B4, B5 | S0.4, Q7 | H · main thread | A8 for B1, B4, B5 | [x] |

### Session 3 — four packages

- **Starts from:** session 2 committed.
- **Ends with:** `ai` and `reader` inside core; apps depend only on core.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S2.1 | Merge `ai` into `core/src/ai/` | S1.3 | M · module-splitter | ai tests pass in core | [x] |
| S2.2 | Merge `reader` into `core/src/reader/` | S1.4 | M · module-splitter | reader tests pass in core | [x] |
| S2.3 | Point build scripts at core subpaths; delete `packages/reader` | S2.2 | M · implementer | all three builds pass | [x] |
| S2.4 | Apps depend only on `@labshelf/core` | S2.1, S2.3 | L · implementer (haiku) | A1 | [x] |

### Session 4 — core foundations

- **Starts from:** session 3 committed.
- **Ends with:** `model/`, `ports/`, the library layout, the identity helpers, shared config, logging and the Node file system each exist once in core.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S3.1 | `core/src/model/` and `core/src/ports/` | S2.4 | M · module-splitter | old folders gone | [x] |
| S3.2 | One library layout definition | S3.1 | M · module-splitter | no hard-coded `"paper.pdf"` or `".research"` outside core | [x] |
| S3.3 | One `metadata.yaml` reader (BC1) | S3.1 | H+M · refactor-step | BC1 tests | [x] |
| S3.4 | Shared cite-key, tag, folder-name, title helpers (BC2, B3) | S3.1 | H+M · refactor-step | BC2 test, A8 for B3 | [x] |
| S3.5 | Shared config in core | S3.1 | M · module-splitter | both apps use it | [x] |
| S3.6 | `core/src/logging/` | S3.1 | M · module-splitter | both apps use it | [x] |
| S3.7 | Node file system in core; one VS Code fs adapter | S3.1 | M · module-splitter | three VS Code adapters merged | [x] |

### Session 5 — library mutations

- **Starts from:** session 4 committed.
- **Ends with:** one set of library mutations in core, used by all three apps.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4.1 | Library mutations in core over a file-system port | S3.7 | H · main thread | core tests for each mutation | [x] |
| S4.2 | Apps use the core mutations (BC3) | S4.1 | H+M · refactor-step | BC3 test; app services reduced to glue | [x] |

### Session 6 — library model and search

- **Starts from:** session 5 committed. Q6 answered.
- **Ends with:** one scanner, tree, store, search and formatter in core.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4.3 | Library snapshot, tree, navigation, store, reindex diff | S4.2 | H+M · refactor-step | old copies gone | [x] |
| S4.4 | One search language (BC4; VS Code list in S9.2) | S4.3 | H+M · refactor-step | BC4 tests | [x] |
| S4.5 | One author formatter and paper formatting (BC5) | S4.3, Q6 | M · module-splitter | BC5 test | [x] |
| S4.6 | External change filter in core | S4.3 | M · module-splitter | both watchers use it | [x] |

### Session 7 — sync

- **Starts from:** session 6 committed. A scratch Drive account is available for S5.3.
- **Ends with:** one sync coordinator, Node sync adapters in core, and B2 fixed.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5.1 | Sync coordinator in core | S4.6 | H · main thread | all three apps drive it | [x] |
| S5.2 | Node lock store and PKCE auth in core | S5.1 | M · module-splitter | copies gone | [x] |
| S5.3 | Browser sync parity (B2) | S5.1 | H · main thread | A8 for B2, scratch-Drive check | [ ] |
| S5.4 | One OAuth credentials source per client type | S5.2 | L · implementer (haiku) | both builds read it | [x] |

### Session 8 — import and capture

- **Starts from:** session 7 committed. Q2 answered.
- **Ends with:** identifiers, landing pages, the resolver chain and pdf.js for Node in core; `core/src/import/` split into subfolders.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S6.1 | One identifier detection | S5.4 | M · module-splitter | copies gone | [x] |
| S6.2 | Landing pages and metadata resolution in core | S6.1 | M · module-splitter | terminal imports a landing-page URL | [x] |
| S6.3 | PDF resolver chain and download in core | S6.2, Q2 | H+M · refactor-step | VS Code and terminal find PDFs by DOI | [x] |
| S6.4 | Split `core/src/import/` | S6.3 | M · module-splitter | A4 for `import/` | [x] |
| S6.5 | pdf.js for Node in core | S6.4 | H · main thread | extension host run passes, terminal thumbnails work | [x] |

### Session 9 — reader host

- **Starts from:** session 8 committed.
- **Ends with:** one reader host controller, VS Code on the core sidecar store, and `reader/dom` grouped.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S7.1 | Reader host controller in core | S6.5 | H · main thread | both hosts use it | [ ] |
| S7.2 | VS Code uses the core `PaperDataStore` | S7.1 | M · module-splitter | VS Code copies gone | [ ] |
| S7.3 | Group and split `reader/dom` | S7.2 | M · module-splitter + code-mapper | A4 for `reader/` | [ ] |

### Session 10 — design system

- **Starts from:** session 9 committed.
- **Ends with:** tokens as data, host maps, shared components and icons; the reader, terminal and badge colours read the tokens; B6 fixed.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8.1 | Tokens as data, `tokens.css` generated (B6) | S7.3 | H · main thread | one highlight palette, A8 for B6 | [ ] |
| S8.2 | VS Code host map `--ls-*` → `--vscode-*` | S8.1 | M · implementer | webviews use `--ls-*` only | [ ] |
| S8.3 | Shared components, one icon set, one nonce, one escape helper | S8.1 | M · module-splitter | copies gone | [ ] |
| S8.4 | Reader themes from tokens | S8.1 | H · main thread | `reader/host.css` shim gone | [ ] |
| S8.5 | Terminal palette from tokens | S8.1 | M · implementer | `theme.ts` maps roles only | [ ] |
| S8.6 | Browser badge colours from tokens | S8.1 | L · implementer (haiku) | no hard-coded colours | [ ] |

### Session 11 — one library UI

- **Starts from:** session 10 committed.
- **Ends with:** the shared library UI in core, used by the VS Code list and the browser library page; the settings webview on core components.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S9.1 | Library UI in `core/src/library-ui/` | S8.3 | H · main thread | typed protocol and components | [ ] |
| S9.2 | VS Code list panel on the shared UI | S9.1 | H+M · refactor-step | `template*.ts` gone | [ ] |
| S9.3 | Browser library page on the shared UI | S9.1 | M · implementer | views copy gone | [ ] |
| S9.4 | Settings webview on core components | S9.1 | M · implementer | no inline HTML/CSS/JS strings | [ ] |
| S9.5 | Parity check | S9.2, S9.3 | M · `verify` skill | A6 | [ ] |

### Session 12 — remaining splits

- **Starts from:** session 11 committed.
- **Ends with:** no file over the limits.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S10.1 | Split terminal `ui/app.ts` and its test | S9.5 | H+M · code-mapper + module-splitter | A4 for `terminal/ui` | [ ] |
| S10.2 | Split terminal `cli/commands.ts`, move `MemoryTerminal` | S9.5 | M · module-splitter | A4 for `terminal/cli` | [ ] |
| S10.3 | Split VS Code `extension.ts` | S9.5 | H+M · code-mapper + module-splitter | one service-build path | [ ] |
| S10.4 | Split VS Code `commands/registerCommands.ts` | S10.3 | M · module-splitter | A4 | [ ] |
| S10.5 | VS Code database per Q1 | S10.3, Q1 | H · main thread | A4, Q1 applied | [ ] |
| S10.6 | Split browser `background/index.ts` | S9.5 | M · module-splitter | A4 | [ ] |
| S10.7 | Split browser `popup/index.ts` | S9.5 | M · module-splitter | A4 | [ ] |
| S10.8 | Split browser `paperController.ts` | S9.5 | M · module-splitter | A4 | [ ] |
| S10.9 | Directory sizes and renames | S10.1–S10.8 | M · module-splitter | A4 everywhere | [ ] |
| S10.10 | VS Code Node code behind `node/` folders | S10.3, S10.5 | H+M · code-mapper + module-splitter | A2 (Node rule) | [ ] |

### Session 13 — comments, docs, checks as errors

- **Starts from:** session 12 committed.
- **Ends with:** A2, A3, A4 and A9 enforced as errors; docs match the code; this plan deleted and a calibration row added.
- **Commit:** one per step.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S11.1 | File headers per package | S10.9, S10.10 | M · comment-enforcer | A9 (headers) | [ ] |
| S11.2 | History language and stale references | S11.1 | M · comment-enforcer | A9 | [ ] |
| S11.3 | Docs paths, checks as errors, delete plan | S11.2 | M · doc-keeper | A2, A3, A4 as errors | [ ] |

### Step blocks

#### S0.1 — Commit the working tree

- **Do:** commit `packages/terminal/` (untracked) and the uncommitted work in `packages/browser/`, `packages/core/`, `packages/reader/`, `packages/vscode/`, `documents/` and `.claude/` as atomic commits.
- **Context:** without this, every later step mixes with unreviewed work, and the rule hook treats untracked files as new.
- **Done when:** `git status` is clean.

#### S0.2 — Core test suite

- **Do:**
  - Add `packages/core/jest.config.cjs` (the same ts-jest setup as the other packages, with the `typescript-js` alias).
  - Move the 18 tests in `packages/vscode/__tests__` that import only `@labshelf/core`, with `sync/fakes.ts` and the fixtures they use:
    - `core/{eventBus,paperMetadata}`, `bibtex/paperArtifacts`, `db/database`;
    - `pdf/{citationFields,pdfIdentifiers,pdfMetadataExtraction,pdfLocalSignals,pdfResolverSearch}`;
    - `sync/{syncLock,syncDiff,syncEngine,syncApply,syncManifest,googleDriveClient,googleDriveProvider,libraryFolderNames,helpers}`.
- **Touch:** `packages/core/`, `packages/vscode/__tests__/`.
- **Done when:** `pnpm --filter @labshelf/core test` runs them, and the VS Code suite still passes.

#### S0.3 — Core from source

- **Do:**
  - Give `packages/core/package.json` an `exports` map to `src`: `.`, `./node`, `./dom`, `./styles/*`.
  - Bundle the VS Code extension host with esbuild. Keep `vscode`, `node:sqlite`, pdf.js and Tesseract external.
  - Drop core's `dist` build.
  - Replace the terminal's source alias and the browser's deep `src/` imports with the `exports` subpaths.
- **Touch:** the build scripts and `package.json` files of all packages, and `packages/vscode/tsconfig*.json`.
- **Context:** pdf.js behaves differently in the extension host than in Node; see [apps/vscode.md](../apps/vscode.md#extension-host-run).
- **Done when:** all three apps build, all tests pass, and an extension-host run imports a PDF.

#### S0.4 — Mechanical checks

- **Do:**
  - Add ESLint `max-lines` (300 for source, 500 for tests) and `max-lines-per-function` (50).
  - Add dependency-cruiser rules: no app-to-app imports, no core-to-app imports, no neutral-to-`node/`/`dom/` imports, no deep imports past an `index.ts`.
  - Add knip.
  - Add core tsconfigs per runtime: neutral (`lib: ["ES2022"]`, `types: []`), node and dom.
  - Every check warns on existing violations and fails on new ones.
- **Touch:** the root config files and `package.json` scripts.
- **Done when:** `pnpm -r lint` runs every check.

#### S0.5 — Root scripts

- **Do:** fix `dev:vscode`, which calls a missing `dev` script. Remove the ignored `packages/*/coverage/` folders.
- **Done when:** the root scripts resolve.

#### S1.1 — `packages/latex`

- **Do:** delete the package and the README lines that mention it.

#### S1.2 — Core dead code

- **Do:** delete:
  - `extractFirstPagesText`, `rewritePath`;
  - the `EVENTS` entries `NOTE_CREATED`, `CITATION_INSERTED`, `PAPER_THEME_CHANGED`, `VSCODE_THEME_CHANGED`, `READING_EVENT`;
  - `HeldSyncLock`, and `detectIdentifier` (singular);
  - the unused `pdfjs-dist` dependency.

  Also pin `yaml`, which is declared as `"*"`.

#### S1.3 — AI dead code

- **Do:** delete `external/semanticScholar.ts` (core's registries cover it), `types/languageModel.ts`, `IVisionEmbeddingProvider`, and the unused `@labshelf/core` dependency. Per Q3, also delete `analysis/`, `detectClaims`, `extractTerms`, `mmrRerank`, `chunkBySlidingWindow`, `titleSimilarity` and `scorePageDifficulty`.

#### S1.4 — Reader dead code

- **Do:**
  - Delete `ZOOM_PRESETS`, `CITATION_STYLES`, `MAX_HOVER_DELAY_MS`, `WebviewCommand` and `PagePreset`.
  - `PDF_THEMES` and `ANNOTATION_COLORS` move to core (they become the runtime lists of their types in S3.1); in this step, only unexport them where they are unused.

#### S1.5 — VS Code dead code

- **Do:** delete:
  - the unreachable barrels: `ai/index.ts`, `ai/indexer/index.ts`, `ai/pdf/index.ts`, `pdf-viewer/index.ts`, `pdf-viewer/renderer/index.ts`, `storage/index.ts`, `storage/data/index.ts`, `storage/paths/index.ts`, `sync/index.ts`, `sync/adapter/index.ts`, `sync/auth/index.ts`, `ui/index.ts`;
  - the shims `pdf-viewer/PdfRenderer.ts` and `storage/paths/workspacePaths.ts`;
  - `reconfigureLibrary`, `baseName` (folderNavigation), `MODELS`, `VISION_EMBEDDING_DEFAULT_ID`, `S2CacheStore`, and the `s2_cache` and `figure_embeddings` tables;
  - the SQLite `annotations` and `paperThemePreferences` tables, `LibraryIndexer.indexPaperData`, and the `IResearchDatabase` methods only they use (`createAnnotation`, `getAnnotationsByPage`, `get/setThemePreference`); the sidecar is the only store for this data;
  - the settings `labshelf.ai.indexOnImport` and `labshelf.ai.textEmbeddingModelId`;
  - the fixtures `mockPapers.ts`, `mock-annotations.json`, `theme-configs.json`, `sample-corrupted.pdf`;
  - the stray `eng.traineddata`;
  - per Q4: `ui/sidebar/placeholderTreeDataProvider.ts` and its views;
  - per Q5: the migrations.

#### S1.6 — Browser dead code

- **Do:**
  - Delete `sync/auth/index.ts`, `RUNTIME_CHANNEL`, the `Browser` type, `capture/doiDetector.ts#detectIdentifiers`, `OVERLAY_CSS`, `assets/labshelf.svg` and `assets/logo.svg`.
  - Delete the storage functions `getDirectSubfolders`, `listAllFolders`, `listByFolder`, `searchRecords`, `upsertFromYaml`, `resetDb` and `IndexedDbFileSystem.getHash`, and the IndexedDB `byHash` and `byFolder` indexes (with a version bump).
  - Unexport `dataController.syncNow`.
  - Delete the re-export shims in `popup/format.ts` and `capture/pdfFetcher.ts`, and point their importers at the real modules.
  - Delete the "coming soon" placeholders in `views/detailSections.ts`.
  - Per Q2, delete or keep the four resolvers and `capture/titleMatch.ts`.

#### S1.7 — Terminal dead code

- **Do:** delete `nullLogger`, `FileLogger`'s `echo` parameter, the unused `shortAuthors` import, `theme.match`, `theme.mode.INPUT` and `bundleDir()`. Move `yaml` to devDependencies.

#### S1.8 — Bugs B1, B4, B5

- **Do:**
  - **B1:** after the library is reconfigured, the sync controller keeps the old `LibraryPaths`, because `ensureSyncController` returns early and `labshelf.configureLibrary` never calls it. Rebuild or repoint the controller, the watcher and the shared-config mirror on reconfiguration (`packages/vscode/src/extension.ts`).
  - **B4:** apply Q7 to `OnnxEmbeddingProvider`, which imports the missing `@xenova/transformers`.
  - **B5:** `CliDriveAuth.authenticate()` always throws. Make it run the login flow so the terminal meets `IAuthProvider` (`packages/terminal/src/sync/driveAuth.ts`).
- **Done when:** each fix has a test that failed before it.

#### S2.1 — Merge `ai`

- **Do:** move `packages/ai/src` to `core/src/ai/` and its tests to `core/__tests__/ai/`.

#### S2.2 — Merge `reader`

- **Do:**
  - `src/shared/*` and `src/webview/logic/*` go to `core/src/reader/` (neutral, with `logic/` as a subfolder).
  - `src/webview/ui/*`, `reader.ts`, `polyfills.ts` and `styles/` go to `core/src/reader/dom/`.
  - `webview/main.ts` and `createVsCodeTransport` go to `packages/vscode/src/reader/`.

#### S2.3 — Build scripts

- **Do:** point `packages/vscode/build/reader.mjs`, `packages/browser/build/vendorReader.mjs` and the terminal build at the core subpaths. Delete `packages/reader/`.

#### S2.4 — Dependencies

- **Do:** remove the `@labshelf/ai` and `@labshelf/reader` dependencies from every `package.json`.

#### S3.1 — Model and ports

- **Do:**
  - Move `types/` to `model/`, adding the runtime lists of the union types (statuses, themes, annotation colours, including those from S1.4).
  - Move `interfaces/`, together with `LocalFileSystem`, `LocalStat`, `LockStore` and `SidecarPort`, to `ports/`.
  - Rename `ExtensionEventBus` to `EventBus`. If only VS Code uses it after session 6, move it into VS Code.

#### S3.2 — Library layout

- **Do:** create `core/src/library/layout.ts` with the file names (`paper.pdf`, `metadata.yaml`, `bib.bib`) and the paths (`papers/`, `.research/papers/<id>/data.json`, `.research/sync/google-drive.{state,lock,last}.json`, logs, `index.sqlite`), with a configurable separator. Replace with it:
  - VS Code `storage/paths/libraryPaths.ts`;
  - terminal `library/libraryPaths.ts`;
  - the inline sync paths in VS Code `syncController.ts` and terminal `cli/commands.ts` (`doctor`);
  - every hard-coded `"paper.pdf"` and `".research"`.

#### S3.3 — One `metadata.yaml` reader (BC1)

- **Do:** make VS Code `LibraryIndexer.readPaper` and browser `recordFromYaml` use core `paperRecordFromMetadata`, and delete their copies.
- **Context:** the browser gains `textLayer` and `hasPdf`, and stops accepting numeric strings.
- **Done when:** there is one test per difference.

#### S3.4 — Identity helpers (BC2, B3)

- **Do:** add to `core/src/library/`:
  - `citeKey.ts`: `makeCiteKey` and a case-insensitive `uniqueCiteKey`, from the browser and terminal copies;
  - `tags.ts`: `normalizeTags`;
  - `folderName.ts`: one validator replacing `extension.ts`/`derive.ts` `isValidFolderName`, terminal `validateCollectionName` and `folderController.validateFolderName`;
  - `titleKey.ts`: the title normaliser from browser `libraryMatch`.
- **Context:** B3 is that VS Code import names the folder `citeKey || fileStem` without a collision check.
- **Done when:** the BC2 test and the B3 regression test pass.

#### S3.5 — Shared config

- **Do:** put the schema and merge rules in `core/src/library/sharedConfig.ts`, and the atomic file I/O with the XDG path in `core/src/library/node/sharedConfigFile.ts`. Replace VS Code `storage/paths/sharedConfig.ts`, the shared part of terminal `app/config.ts`, and `platform/dirs.ts#configDir`.

#### S3.6 — Logging

- **Do:** create `core/src/logging/` with the JSON-lines `LogEntry` format, a logger over a port, and an append-only Node file sink. Replace VS Code `core/logger.ts`, which rewrites the whole file on every entry, and terminal `app/logger.ts`.

#### S3.7 — File systems

- **Do:** move `NodeFileSystem`, `NodeLocalFileSystem` and `writeFileAtomic` from terminal `platform/nodeFileSystem.ts` to `core/src/library/node/`. Merge VS Code `fileSystemService.ts`, `vscodeFileSystem.ts` and `vscodeLocalFileSystem.ts` into one `vscode.workspace.fs` adapter that implements both ports.

#### S4.1 — Library mutations

- **Do:** build over a port with `exists`, `stat`, `mkdir`, `rename`, `readText`, `writeTextAtomic`, `writeBytes`, `listDir` and `trash`:
  - `paperFields.ts`: user fields, with the owned-keys rule and VS Code's status-on-disk rule;
  - `paperMoves.ts`: move papers; move, rename and trash folders;
  - `paperImport.ts`: import a PDF or a folder of PDFs, with the `%PDF-` check and collision-free cite keys;
  - `textLayerVerdict.ts`: the verdict logic from VS Code `PaperService`;
  - `importSummary.ts`: one "N imported, M failed" message, replacing the copies in `extension.ts`, `registerCommands.ts` and the terminal's `reportImport`.
- **Context:** base on terminal `TerminalPaperService`, which already re-reads from disk before writing. VS Code adds the status-on-disk and text-layer rules.

#### S4.2 — Apps on the mutations (BC3)

- **Do:**
  - VS Code `PaperService` keeps only the index updates and events, or disappears.
  - Terminal `TerminalPaperService` keeps its Node port and `findPdfs`.
  - Browser `paperController` status, move and delete go through core over the IndexedDB adapter.
- **Done when:** a test shows the browser keeps foreign keys and the on-disk status.

#### S4.3 — Library model

- **Do:** move into `core/src/library/`: the scanner over `listDir`/`stat`, the folder tree with counts, `folderNavigation` (breadcrumb, parent, relative folder), the in-memory store with sort and filter, and the reindex diff. Replace with them:
  - VS Code `ui/library/{collectionFolders,folderNavigation}.ts` and `storage/data/{libraryIndexer,reindexLibrary}.ts`;
  - terminal `library/{libraryScanner,libraryStore}.ts`;
  - the pure parts of browser `library-page/state/derive.ts` and `storage/folderTreeStore.ts`.

#### S4.4 — Search (BC4)

- **Do:** create `core/src/library/search/`, based on the terminal language: `tag:`, `status:`, `year:` with ranges, `author:`, `has:`/`no:`, phrases and `-exclusions`. Add VS Code's aliases (`kw`, `venue`, `note`, `key`, `abstract`), fuzzy matching for pickers, and accent folding (move `fold` out of `tui/text.ts`). The terminal and the browser use it. The VS Code list searches inside its string-template webview script, which cannot import core; it adopts core search in S9.2, when the list moves to the shared UI.

#### S4.5 — Formatting (BC5)

- **Do:** create `core/src/library/format.ts` with one author formatter (per Q6), `paperLink`, `relativeTime` and `venueLine`. The list, the terminal, the popup and the reader citation all use it.

#### S4.6 — External change filter

- **Do:** move the noise filter and `findMissingPapers` to core. VS Code `ExternalChangeWatcher` and terminal `LibraryWatcher` keep only the platform watcher.

#### S5.1 — Sync coordinator

- **Do:** create `core/src/sync/coordinator/`, based on terminal `sync/syncService.ts`. It is an event-free state machine with an injected clock, covering:
  - one run: lock, manifest, engine, folder names, run record;
  - the 30 s change debounce;
  - periodic runs with the "synced recently" skip;
  - the outcome when the lock is busy.

  Merge `syncChangedLibrary`/`libraryChanged` into it. VS Code keeps the status bar, settings and events. The browser keeps alarms, idle detection and the badge.

#### S5.2 — Sync Node adapters

- **Do:**
  - Move `NodeLockStore` and `isProcessAlive` to `core/src/sync/node/` and delete both copies.
  - Add `PkceLoopbackAuth(client, tokenStore, openBrowser, fetch)`, based on terminal `driveAuth.ts` (it has state checks, a timeout and `ReauthRequiredError`). VS Code supplies `SecretStorage` and `openExternal`; the terminal supplies its keychain store and `openBrowser`.
  - The Drive URLs and scopes become core constants, used by the browser auth too.

#### S5.3 — Browser sync parity (B2)

- **Do:** make browser sync run through the coordinator, so it passes `libraryFolderNames` and writes the run record.
- **Context:**
  - Before the change, check on a scratch Drive what folder names the browser creates.
  - Existing citekey-named folders must keep their names, through the manifest-first rule in [contracts/sync.md](../contracts/sync.md#folder-names).
- **Done when:** the B2 regression test passes, and on the scratch Drive the existing folders are not renamed or duplicated.

#### S5.4 — Credentials source

- **Do:** keep one OAuth credentials source per client type, read by both the VS Code and the terminal builds. The terminal build stops copying the VS Code file.

#### S6.1 — Identifiers

- **Do:** merge into core identifier detection:
  - browser `capture/doiDetector.ts` (`cleanDoi`, `arxivIdFromDoi/Url`, `pmidFromUrl`);
  - terminal `identifiersIn`;
  - VS Code `fetchMetadata.lookupUserQuery`/`doiOrUrl`.

#### S6.2 — Landing pages

- **Do:** move these into `core/src/import/`:
  - browser `capture/{htmlPage,pageFacts,metadataResolver,libraryMatch,recordCapture}.ts`;
  - the pure part of `scholarCapture.ts`;
  - the `RawPage` types.

  Reuse the registries' `yearOf`.
- **Done when:** terminal `importUrl` handles a landing page.

#### S6.3 — PDF resolver chain

- **Do:** move the live resolvers (pubmed, page, arxiv, publisher, crossref, unpaywall, sci-hub), `pdfBytes.ts` and the fetch part of `pdfFetcher.ts` to `core/src/import/pdf/`. The browser injects `helperTab`, `fetchInTab` and `probeTab`. VS Code and the terminal use the chain for DOI imports. Per Q2, wire in the four resolvers as [pdf-finding.plan.md](pdf-finding.plan.md) describes.

#### S6.4 — Split `import/`

- **Do:**
  - Split `registries.ts` (578 lines) into one file per registry, plus `http.ts` and `text.ts`.
  - Split `localSignals.ts` into front matter, running head and info dictionary.
  - Take confidence and pdf errors out of `parser.ts`, title matching out of `resolver.ts`, and layout heuristics, title quality and cite key out of `extractor.ts`.
  - Keep at most 8 files per folder.

#### S6.5 — pdf.js for Node

- **Do:** move `loadPdfjs` and the data options to `core/src/import/node/`, with an option for VS Code's Electron shims, plus the `@napi-rs/canvas` loader shared with the terminal thumbnail worker. Tesseract and the searchable-PDF builder stay in VS Code.
- **Done when:** an extension-host import works and the terminal renders thumbnails.

#### S7.1 — Reader host controller

- **Do:** create `core/src/reader/hostController.ts`. It answers every reader message over ports (sidecar store, clipboard, external links, file export, theme persistence) and merges `PdfViewerPanel._dispatch` with `BrowserReaderHost.dispatch`. Each host keeps only its lifecycle and ports.

#### S7.2 — Sidecar store

- **Do:** VS Code uses the core `PaperDataStore` through a Node `SidecarPort` in `core/src/reader/node/`, which the terminal shares. Delete VS Code `storage/data/paperDataStore.ts`, `pdf-viewer/AnnotationManager.ts` and `pdf-viewer/config.ts`.

#### S7.3 — Reader structure

- **Do:**
  - Group `dom/` (26 files) into `chrome/`, `sidebar/`, `find/`, `hover/`, `navigation/`, `text/` and `host/`, and group `logic/` (13 files) the same way.
  - Split `hoverPreview.ts` (441 lines) into link target, text target, popup and text geometry.
  - Split `paperData.ts` into schema and store.

#### S8.1 — Tokens (B6)

- **Do:**
  - Create `core/src/ui/tokens.ts` with: the colour roles for light and dark, seeded from browser `ui/styles/tokens.css` (VS Code Dark and Light Modern); the status colours; one highlight palette; the type scale, spacing, radii and elevation.
  - A build step generates `tokens.css`.
- **Context:** B6 is that the list panel's highlight colours differ from the reader's.

#### S8.2 — VS Code host map

- **Do:** create `core/src/ui/dom/vscodeHost.css` mapping every `--ls-*` token to its `--vscode-*` variable. VS Code webviews use only `--ls-*`.

#### S8.3 — Components and icons

- **Do:**
  - Move browser `ui/{dom,menu,dialog,quickInput,toast,theme}.ts` and `ui/styles/base.css` to `core/src/ui/dom/`.
  - Merge the three icon sets (VS Code `template.icons.ts`, browser `ui/icons.ts`, reader `ui/icons.ts`) into `core/src/ui/icons.ts`, with one stroke width and one glyph per meaning.
  - Merge the three nonce helpers and the `esc`/`escapeHtml` copies.

#### S8.4 — Reader themes

- **Do:** `reader.css` uses `--ls-*`. The page themes and pdf.js `pageColors` come from one table derived from the tokens. Delete the `--vscode-*` shim in browser `reader/host.css`.

#### S8.5 — Terminal palette

- **Do:** `terminal/src/ui/theme.ts` reads the colour roles from the core tokens and only maps them to terminal capabilities.

#### S8.6 — Badge colours

- **Do:** `background/badgeUpdater.ts` reads its colours from the tokens.

#### S9.1 — Library UI

- **Do:** create `core/src/library-ui/` with the list state, list, rows, detail pane and sections, folder header and chips, and the filter bar, as typed TypeScript components. Start from browser `library-page/views/*` and `state/libraryStore.ts`. Add a typed message protocol and a transport port. Use only `--ls-*` tokens and core components. The protocol and the transport port know nothing about the host: the same messages serve the VS Code webview and the browser page, and views added later, such as Writing, join the same protocol.
- **Context:** follow [product.md](../product.md): paper-first, and navigating never rebuilds the view.

#### S9.2 — VS Code list on the shared UI

- **Do:** `ListWebviewPanel` bundles the core library UI and supplies a `postMessage` transport and a typed handler. Delete `ui/list/template*.ts` (about 2,800 lines) and the untyped 20-case switch. Merge `citationFormats.ts` with the reader's `citationFormat.ts` in core. The list then uses core search (BC4), core relative time, file size and venue line (BC26), and the core sort order (BC23), which its webview script still copies.

#### S9.3 — Browser library page on the shared UI

- **Do:** keep only the IndexedDB controllers, the router and the bootstrap.

#### S9.4 — Settings webview

- **Do:** rebuild `ui/settings/` with core components, with no inline HTML, CSS or JS strings.

#### S9.5 — Parity check

- **Do:** render the list in VS Code (Dark and Light Modern) and in the browser (dark and light) from the same library copy, then screenshot and compare them ([apps/README.md](../apps/README.md#verifying-changes)).

#### S10.1 — Terminal `ui/app.ts` (1,613 lines)

- **Do:**
  - `app.ts` keeps only the shell: state, lifecycle, `render`, `handle`.
  - Add `ui/state/` (types, browser model, navigation, selection), `ui/input/` (dispatch, inline find and filter, overlay input), `ui/overlays/` (pickers, completion), `ui/actions/` (prompts, papers, move, copy, export, import, sync), `ui/commandLine.ts`, `ui/notify.ts`, `ui/mouse.ts`, and `ui/view/` (frame, preview pane, image layer).
  - `completePath` and `looksLikePath` go to `platform/`.
  - Split the 2,326-line test the same way.

#### S10.2 — Terminal CLI

- **Do:** split `cli/commands.ts` into `cli/{usage,output,library,mutate,sync,doctor}.ts`. Move `MemoryTerminal` and `keysToInput` from `main.ts` to `tui/memoryTerminal.ts`.

#### S10.3 — VS Code `extension.ts`

- **Do:** split it into:
  - `activation/buildServices.ts`, the single place that rebuilds services; merge the three copies of build → set root → ensure sync controller into it;
  - `activation/libraryLifecycle.ts`;
  - `commands/{folderCommands,readerCommands,syncCommands}.ts`;
  - `views/registerViews.ts`.

#### S10.4 — VS Code commands

- **Do:** split `registerCommands.ts`. Registration stays in VS Code; message formatting is already in core from S4.1.

#### S10.5 — VS Code database

- **Do:** per Q1, remove the paper index and `IResearchDatabase`; the in-memory store from S4.3 serves the list. SQLite stays only for the AI stores.

#### S10.6 — Browser background

- **Do:**
  - Split into `router.ts` (sender check and dispatch table), `handlers/{auth,sync,capture,library,tabs}.ts` and `broadcast.ts`.
  - Move the typed `send()` (copied four times) to `platform/messaging.ts`.
  - Merge the `errorText` copies into one helper.

#### S10.7 — Browser popup

- **Do:** split into `state.ts`, `saveFlow.ts`, `syncButton.ts` and `index.ts`.

#### S10.8 — Browser paper controller

- **Do:** split into PDF actions, mutations and capture from a tab. The IndexedDB adapters go to `storage/adapters.ts`.

#### S10.9 — Directories and renames

- **Do:**
  - Bring every directory to at most 8 source files: browser `capture/`, `capture/resolvers/`, `library-page/views/`, `ui/`; VS Code `ui/list/`; core `import/`, `sync/core/`, `ai/heuristics/`.
  - Rename `sync/core/` to `sync/engine/`.
  - Rename VS Code `src/core/` so it does not clash with the package name.

#### S10.10 — VS Code Node boundary

- **Do:**
  - Move every VS Code file that imports `node:*` or a Node-only package (`node:sqlite`, Tesseract, pdf.js for Node, `child_process`) into a `node/` folder of its domain, behind a port the rest of the extension uses.
  - Add a dependency-cruiser rule: outside `node/` folders, VS Code imports no `node:*` and no Node-only package. Known violations go to the baseline like the other rules.
- **Context:** the writing workflow runs the extension as a web extension (vscode.dev and the browser editor). This rule keeps the Node part small and visible.
- **Done when:** the rule runs and its baseline lists only what cannot move yet.

#### S11.1 — File headers

- **Do:** remove the `@depends`, `@dependents` and `@usedBy` tags, and keep or write a purpose header of one or two lines.
- **Context:** the removed YAML specs held the reasons behind some non-obvious code: the text-layer focus guard, the toolbar `engaged` flag, the find-scroll offsets, and the cross-source action dedupe. When such code does not explain itself, read the spec in the last commit that has `documents/specs/`, and keep the reason as a short comment.

#### S11.2 — History language

- **Do:** remove planning tags ("Phase 2", "D4", "Feature C") and history wording from comments. Fix these stale references:
  - `ThemeManager` → `pdf-viewer/shared`;
  - `fileSystemService` → `bibtex/`;
  - `embeddingCodec` → `figureVectorStore`;
  - the terminal `NodeLockStore` header ("O_EXCL");
  - the resolver order text in `options/index.html`.

#### S11.3 — Close the plan

- **Do:** update the changed paths in `documents/`, delete the note at the top of `architecture.md`, and switch every check from S0.4 to error. Add a row to [CALIBRATION.md](CALIBRATION.md), then delete this plan.

## 7. Risks

- **R1** The working tree is large and partly untracked. — S0.1 commits it before anything moves.
- **R2** Bundling the VS Code host with esbuild (S0.3) can break pdf.js, Tesseract or `node:sqlite` in the extension host. — Keep them external, and verify with the extension-host recipe before going further.
- **R3** Browser sync parity (S5.3) can rename or duplicate folders on Drive. — Test on a scratch Drive first, and rely on the manifest-first naming rule.
- **R4** Merging two copies hides a behaviour difference. — `code-mapper` lists the differences, and each one is decided explicitly (D5), with BC changes tested (D7).
- **R5** A long plan drifts from the code. — Each session starts from a clean, committed tree. If a mapped fact turns out wrong, fix the step block before executing it.
- **R6** The IndexedDB version bump (S1.6) runs on users' browsers. — Removing indexes is a safe upgrade, but test the upgrade from the current version.

## 8. Log
- 2026-10-08 S0.1 done: working tree committed as 8 commits (`889043c`..`1e8a74b`), tree clean.
- 2026-10-08 S0.2 done in two parts. Part 1: core has its own jest config and runs 12 test suites (127 tests) mirroring `src/`. Part 2 (moving `syncDiff`, `syncEngine`, `syncApply`, `syncManifest`, `libraryFolderNames`, `helpers` and `sync/fakes.ts`) waits for the `exports` map of S0.3, because `syncControllerLock.test.ts` in VS Code shares `FakeRemoteProvider` and needs a core test-support subpath. Also fixed the stale `PdfViewerPanel` default-column test.
- 2026-10-08 S0.3 done: core and reader export TypeScript source (no `dist`); the VS Code host is bundled by esbuild (`build/host.mjs`, `out/extension.js`); the terminal alias is gone; the test tsconfigs of browser and terminal use Node16 resolution. S0.2 part 2 landed here: the six sync tests and `syncFakes.ts` are in core, and VS Code reaches the fakes through the `@labshelf/core/test-support/sync-fakes` export (core 175 tests + VS Code 360 = the 535 from before). `./node`, `./dom` and `./styles/*` are not exported yet: no file exists for them, and the steps that create the folders add the entries. Reader exports source for the same reason (it imports core source); `ai` keeps its `dist` until S2.1. Extension-host run on a library copy: activates, imports a PDF, resolves metadata, opens the reader. It found a startup bug in `activate()` (`externalWatcher` used before its declaration, which broke activation for any configured library); fixed in its own commit.
- 2026-10-08 S0.4 done: `pnpm run lint` runs ESLint (size limits, with `eslint-suppressions.json` as the baseline: 75 known), dependency-cruiser (415 known, all `no-import-past-index`; known-violations file), knip (155 findings, warning only), the core neutral-runtime tsconfig check (30 known) and the directory-size check (10 known). Each fails on a new violation. Decisions: ESLint rules are `error` plus bulk suppressions, because suppressions keep the rule's severity; `.pnpmfile.cjs` gives the tools a TypeScript 6 JS copy, as for ts-jest; `@labshelf/ai` is not followed by dependency-cruiser until it is consumed from source (S2.1); the 30 neutral-runtime errors are web globals (`fetch`, `URL`, `TextEncoder`, timers) that need a design call in a later session.
- 2026-10-08 S0.5 done: the VS Code package gets a `dev` script that watches the host and the reader bundle; `pnpm dev:vscode` runs both. The ignored `packages/*/coverage/` folders are deleted.
- 2026-10-08 S1.2–S1.7 done (Q2: the four resolvers and `titleMatch.ts` stay for pdf-finding.plan.md; Q3, Q4, Q5 delete). Kept because still used: `rewritePath` (unexported), `HeldSyncLock` (unexported from the barrel), `scorePageDifficulty` and `extractTerms` in ai (the ingestion difficulty score calls them; only their barrel exports went), `shortAuthors` in the terminal. Reader constants are unexported where only their own file uses them. IndexedDB version 2 drops the `byHash` and `byFolder` indexes. A pre-existing VS Code `index.sqlite` without the later `papers` columns must be deleted once; it is a rebuildable cache.
- 2026-10-08 S1.8 done: B1 `SyncController.setPaths` repoints the controller when the root changes and `labshelf.configureLibrary` calls `ensureSyncController`; B4 the ONNX path and the model download are gone (the hash provider is built directly, `degradedMode` and the two model events deleted); B5 `CliDriveAuth.authenticate()` keeps stored tokens or runs the login flow with the options the composition root passes. Each has a test.
- 2026-10-08 S1.1 done: `packages/latex`, its `knip.json` entry, its README mention and its lockfile entry are gone.
- 2026-10-08 S2.1 done: `packages/ai` lives in `core/src/ai/`, exported from the core index; vscode imports it from `@labshelf/core`. `ai` has no `normalizeTitle` (it left with the analysis code in S1.3), so no rename was needed. `heuristics/` is split into `extractors/` and `scoring/` to meet the directory limit. The dependency-cruiser baseline lost 22 `ai` entries and 7 stale ones; a browser import past `capture/index.ts` that had no baseline entry now goes through the index.
- 2026-10-08 S2.2–S2.4 done in one commit: moving the reader files breaks the build scripts, and an emptied `packages/reader` cannot typecheck, so the build-script repoint (S2.3) and the dependency removal (S2.4) landed with the move. The reader's `shared/` and `logic/` are in `core/src/reader/`, its DOM code in `core/src/reader/dom/` (UI pieces stay in `dom/ui/` until S7.3), exposed as `@labshelf/core/dom` and `@labshelf/core/styles/*`; `main.ts` and `createVsCodeTransport` are in `packages/vscode/src/reader/` with their own webview tsconfig. The `pdf_viewer.mjs` type imports carry `resolution-mode: import`, so core keeps Node16 resolution. Core has 502 tests (208 + the reader's 294); the dependency-cruiser baseline dropped 65 entries and the neutral-runtime baseline grew from 30 to 35 (`URL`, `crypto`, timers in the moved files). The three builds pass.
- 2026-10-08 15:28 S3.1 done: `core/src/types` is `model/` (paper record, status, text layer, annotation, PDF theme, each with its runtime list and guard) and `core/src/interfaces` is `ports/`, which also holds `LocalFileSystem`, `LocalStat`, `LockStore` and `SidecarPort`. The apps take the status, colour, annotation-type and theme lists from core; VS Code `pdf-viewer/config.ts` and `ThemeManager.isValidTheme` are gone. `ExtensionEventBus` is `EventBus` and stays in core until session 6 decides. Status sort order and status aliases still differ per app; S4.3 and S4.4 settle them. BC6–BC9 added to D7 (asked while mapping S3.3 and S3.4).
- 2026-10-08 15:40 S3.2 done: `core/src/library/layout.ts` names every library file and path, generic over the path type (`Uri` in VS Code, OS paths in the terminal, relative keys in the browser). VS Code `libraryPaths.ts` is gone; the terminal keeps its Node-only root helpers in `library/libraryRoot.ts`. The browser keeps its `appdata` root and its `google-drive` manifest key. Path output is unchanged. Dependency-cruiser baseline 315 → 289. BC10–BC12 added to D7 (asked while mapping S3.5–S3.7).
- 2026-10-08 15:44 S3.3 done: VS Code `LibraryIndexer` and the browser `rebuildFromFiles` read `metadata.yaml` through core `parsePaperMetadata` and `paperRecordFromMetadata`; `recordFromYaml` and the `yaml` dependency of vscode and browser are gone. BC1: the browser gains `textLayer` and `hasPdf`, drops YAML numbers in string fields, and keeps blank strings and list entries as core does. BC8: VS Code skips a list-shaped `metadata.yaml`. A round-trip test pins that LabShelf writes numeric-looking strings quoted.
- 2026-10-08 15:56 S3.4 done: `core/src/library/identity/` holds `makeCiteKey`, a case-insensitive `uniqueCiteKey`, `claimCiteKey` (the folder-exists loop the apps copied), `normalizeTags`, `validateFolderName` and `titleKey`; the terminal, browser and VS Code copies are gone. B3: VS Code import claims a free cite key against the index and the disk (regression tests in `paperServiceImport.test.ts`). BC2, BC6, BC7 and BC9 each have a test. The browser popup's `"# foo"` tag becomes `foo` (it kept a leading space). Core `buildCiteKey` (PDF import) and sync's `isSafeFolderName` stay separate: their rules differ on purpose.
- 2026-10-08 16:08 S3.7 done (before S3.5, which needs the atomic write in core): `@labshelf/core/node` exists and exports `writeFileAtomic`, `NodeFileSystem` and `NodeLocalFileSystem` from `core/src/library/node/`; a dependency-cruiser rule stops the browser importing core `node/`. The terminal keeps only `platform/nodeLockStore.ts` until S5.2. VS Code has one `VscodeFileSystem` for both ports, built per library root because its temp dir is `.research/tmp`; `SyncController.setLibrary` takes the new adapter on a root change. BC11 (atomic writes, every VS Code write through the adapter) and BC12 (deleting a missing file succeeds) have tests. Core `tsconfig.json` loads Node types; the neutral config still keeps `node:*` out of neutral code. Dependency-cruiser baseline 289 → 278.
- 2026-10-08 16:14 S3.5 done: the shared config schema and merge rules are in `core/src/library/sharedConfig.ts`, the XDG path and atomic file update in `library/node/sharedConfigFile.ts`. The terminal keeps only its preferences and `resolveLibraryRoot` (which still expands `~` and relative roots; VS Code accepts only absolute ones, as the contract says). VS Code logs a failed mirror of `libraryRoot` and mirrors once, from `ensureSyncController`; an unchanged update skips the write. Dependency-cruiser baseline 278 → 276.
- 2026-10-08 16:20 S3.6 done: `core/src/logging/` has the entry format and a `Logger` that fans out to `LogSink` ports (`ports/logSink.ts`) and never rejects; `logging/node/fileLogSink.ts` appends through a queue and rotates to `.1` at 2 MiB. The terminal and VS Code loggers are gone; VS Code builds its logger in `core/extensionLogger.ts` (file plus SQLite sinks, sink failures to `console.error`), the terminal drops sink failures on purpose because the TUI owns the screen. BC10 has tests. Non-`Error` values are logged without a synthetic stack. `library-format.md` names the rotation file.
- 2026-10-08 16:44 S4.1 done: `core/src/library/mutations/` holds the paper field, move, trash, folder, import, import-summary and text-layer verdict functions over the `LibraryFileSystem` port (`ports/libraryFileSystem.ts`: the two existing ports plus `rename`, `trash`, `mkdir`); `NodeLibraryFileSystem` is in `@labshelf/core/node` with an injected trash. Mutations write disk only and return what changed; apps update their index afterwards. `library/` does not import `io/`: the artifact writer and the PDF parser are structural ports. BC13–BC19 added to D7 (asked while mapping); each has a core test. The apps still use their own copies until S4.2. Core 723 tests.
- 2026-10-08 17:01 S4.2 done: the three apps mutate the library through core. VS Code `PaperService` is glue (684 → 218 lines) beside `paperImporter.ts` and `paperTextLayers.ts`; the folder commands left `extension.ts` for `commands/folderCommands.ts`; one `importPapers` flow and `summarizeImport` replace the three message builders; `BatchImportResult` is gone. The terminal service is glue in `library/papers/` (529 → 219), with network imports in `networkImport.ts`; its 1,148-line test file is split into glue tests. The browser's `IndexedDbFileSystem` implements `LibraryFileSystem` (`mkdir` writes the `.keep` sentinel, `trash` deletes), `storage/libraryMutations.ts` applies results to the record cache, and both `IdbTextAdapter` copies are gone. BC3 tests: foreign key kept, only status written, on-disk status kept on PDF attach. BC20–BC22 added to D7. `importPaths` reports each outcome as it finishes so VS Code lists papers one by one. Sync's tree scan skips and logs an unreadable folder, but no app passes a logger to the sync engine yet: S5.1 wires it. Pre-existing size violations untouched apart from 1–10 lines on terminal `cli/commands.ts` and its test and browser `background/index.ts` (S10.2, S10.6).
- 2026-10-08 Session 5 finish: comments and docs updated (`architecture.md` names the library file-system port and the mutations; `library-format.md` names the browser's `.keep` sentinel). Nothing yet skips `.keep` in listings or sync, as before this session: the S4.3 scanner skips dot entries, and S5.1 decides whether sync uploads it.
- 2026-10-08 18:18 S4.3 done: `core/src/library/scan/` (scanner over a narrow `ScanFileSystem` port with `listDir`, `stat`, `readText`; folder level; bounded concurrency) and `library/model/` (snapshot, collection tree, folder navigation over `(root, path, sep)`, paper sort, `LibraryStore` with an injected `filterFor`, reindex diff). The terminal scanner and store, VS Code `collectionFolders`, `folderNavigation`, `libraryIndexer` and `findMissingPapers`, and the browser's pure tree and path helpers are gone. A failure to list `papers/` itself throws, so a reindex never mistakes it for an empty library; deeper unreadable folders are logged and skipped. VS Code reindex is scan → diff → SQLite and deletes removed papers (BC25); the list webview script keeps its own sort until S9.2. BC23 and BC24 have core tests. The terminal search language reaches the store through `library/paperSearchIndex.ts` until S4.4. Size: four files already over 300 lines grew by 1–3 lines (S10).
- 2026-10-08 18:25 S4.4 done: `core/src/library/search/` holds the query language (terminal base plus the `kw`, `venue`, `note`, `key` and `abstract` field filters), the folded search document, scoring, `SYNTAX_HELP`, and `text/` (`fold`, picker fuzzy, accent-aware `highlightRanges`). The terminal list filter and find search annotation text through `PaperSearchIndex.matcher`; its help overlay and the browser search tooltip render `SYNTAX_HELP`. The browser searches the wider field set with phrases, exclusions and operators; touching highlight ranges merge into one mark. An operator with no value is ignored. The VS Code list keeps its webview search until S9.2. The browser rebuilds each search document per call; cache it per record if large libraries feel slow.
- 2026-10-08 18:31 S4.5 done: `core/src/library/format/` holds `formatAuthors`/`familyName` (Q6: "A & B"), `relativeTime` (BC26), `venueLine`, `paperLink` (BC27) and `formatBytes`. The reader citation label, the terminal, the browser popup, library page and detail head (which gains volume, issue and pages), and the VS Code article link and citation DOI use them; the terminal says `never` for no date. The VS Code list host sends `creator`; its webview script keeps `lastName`, `fmtAgo`, `fmtSize` and its venue head until S9.2.
- 2026-10-08 18:33 S4.6 done: `core/src/library/externalChange/` holds `isExternalChangeNoise`; the VS Code and terminal watchers keep only the platform watch and their debounces (1000 ms and 250 ms; the reactions differ in cost). `findMissingPapers` left in S4.3, because the reindex diff reports removed papers. BC28 has a test; the terminal watcher has its first test.
- 2026-10-08 18:35 Session 6 finish: `architecture.md` names the `scan/`, `model/`, `search/`, `format/` and `externalChange/` folders of core `library/`; leftover dependency tags in touched files and unused exports are gone. Per S3.1, the event bus moved into VS Code (`packages/vscode/src/events/`), its only user. No acceptance criterion closes this session; A5 gains the library model, search and author formatting, and the VS Code list webview still copies search, sort and time formatting until S9.2.
- 2026-10-08 19:12 S5.1 done: `core/src/sync/coordinator/` runs one sync (lock, titles, manifest, engine with the app logger, run record), the 30 s debounce, periodic runs with the recent-run skip and the busy outcome, over injected timers (`SyncTimers`, so the browser keeps `bx.alarms`) and an `onOutcome` hook for app reactions; core `libraryChanged` replaces both app copies. The terminal keeps `terminalSync.ts` and `driveAccount.ts`; VS Code `SyncController` is glue plus `syncReport.ts`; the browser has `sync/browserSync.ts`, `background/alarmSyncTimers.ts` and `background/syncMessages.ts`, with no lock, folder names or run record until S5.3. BC29–BC32 added to D7 (asked while mapping). Also decided: a failed store reload or browser rebuild after a sync is logged and the run counts as synced; VS Code settings show the shared run record; VS Code re-reads the interval on connect and on a setting change and stops periodic runs on disconnect; the browser loads its stored token before each run, so syncs run after a service-worker restart (they failed before). Sync uploads `.keep`, the browser's empty-folder marker (`sync.md`). The terminal `syncService.test.ts` (866 lines) is split into core coordinator tests and terminal glue tests. Five `no-import-past-index` errors from earlier sessions are left for the session finish.
- 2026-10-08 19:29 S5.2 done: `core/src/sync/auth/` holds the Google endpoints and scopes, the token types and `parseTokens`, `resolveOAuthClient`, `ReauthRequiredError` and the token client; `core/src/sync/node/` holds `NodeLockStore`, `isProcessAlive`, the loopback code server and `PkceLoopbackAuth` (single-flight refresh, logs without tokens or codes). VS Code signs in through it with `secretStorageTokenStore.ts` (key and shape unchanged) and shows a Copy Link warning when the browser does not open; the terminal keeps its file, keychain and Secret Service stores in `terminalAuth.ts`; the browser and the Drive client use the core endpoints. Also decided with BC32: a `YOUR_` placeholder client means not configured in VS Code, a reauth failure refreshes the VS Code status bar, revoke failures are logged, the terminal `authenticate()` runs the login, and its not-signed-in errors name `labshelf auth login`. Credentials files are untouched until S5.4. The S5.1 browser `folderController` test mocked the logger by its old path; fixed in its own commit.
- 2026-10-08 19:35 S5.3 code done, step left open for the scratch-Drive check: browser sync passes `listTitles` from its paper records and keeps the run record in IndexedDB under `google-drive.last.json` (lock-free), so new Drive folders are named after the title and the recent-run skip survives a service-worker restart. Before, the browser named the Drive folders it created after the paper id. The engine registers every remote folder under its manifest-first local name and creates folders only for unregistered paths, so existing id-named folders are reused in every app and never renamed; a browser and a core guard test pin this. The B2 regression tests fail on the previous `browserSync.ts`. The browser test `fakeIdb` keeps separate stores. Manual check for the user: build the pre-change extension, sync two papers to a scratch Drive, load the new build in the same profile, add a file to an old paper and save a new one, sync; the old folders keep their names and ids with no title-named sibling, the new paper's folder has its title, a file uploaded on Drive into an old folder arrives, and the last sync time survives an extension reload.
- 2026-10-08 19:44 S5.4 done: the gitignored `credentials/google-desktop.json` (VS Code and the terminal) and `credentials/google-web.json` (the browser) hold the OAuth clients, with committed `.example.json` templates. `scripts/googleCredentials.mjs` turns them into esbuild defines, and core `BUILT_IN_GOOGLE_CLIENT` reads them; the six credential modules and the terminal's copy step are gone. Build-time env vars override the files. A build without the file builds an unconfigured client and says so. The browser bundle never carries the desktop secret (checked on the built bundles).
- 2026-10-08 19:45 Session 7 finish: barrels for VS Code `commands/` and `pdf/` and browser `storage/idb/` clear the five `no-import-past-index` errors, so `pnpm run lint:deps` exits 0; stale baseline entries dropped. No acceptance criterion closes this session: A5 gains the lock store, PKCE auth and the sync coordinator, and A8 waits on B2's scratch-Drive check (S5.3 open).
- 2026-10-08 20:02 S6.1 done: `core/src/io/identifiers/` holds `extractDoi` and `cleanDoiCandidate` (one DOI cleanup, BC33), `doiVariants`, the arXiv and PubMed URL helpers, the PDF `detectIdentifiers` and `identifiersFromInput` (BC34), which the terminal add/import and VS Code Fetch Metadata share. It sits under `io/` until S6.4 moves the domain. The browser `doiDetector.ts`, the terminal `identifiersIn` and the private DOI regexes in `xmp.ts` and `localSignals.ts` are gone. Q2 answered: wire the four resolvers in during S6.3. `detectIdentifiers` percent-decodes metadata and link targets before scanning; XMP and local signals use the browser's DOI scan, which stops at `,'[]{}|^`. The Scholar content script grew by 459 bytes.
- 2026-10-08 20:16 S6.2 done: `core/src/io/landing/` reads a landing page (regex HTML parsing, page facts, PDF candidates, `fetchLandingPage` with injected `fetch`), and `core/src/io/resolution/` holds `resolveMetadata` and `withAbstract` with injectable registry deps, title agreement, `findInLibrary` and `idsFromRecord`. The browser keeps `probe()` (serialised into the tab), the Scholar hit mapping and `landingFacts.ts`, which binds its fetch options. The terminal imports a landing-page URL (BC37) through `landingImport.ts`, `downloads.ts` and `writeImportedPaper.ts`, the record writer it shares with identifier imports. BC35 and BC36 decided without asking, as the user asked for this session. One `extractYear` replaces the copies in registries, XMP and local signals. The three HTML fixtures live in `core/__tests__/fixtures/`, and the browser `pdfFetcher` test reads them there until S6.3. The neutral-runtime baseline goes from 35 to 45 (`URL`, `fetch`, `AbortController`, timers). Terminal `paperService.ts` is 226 lines.
- 2026-10-09 16:46 S6.3 done in two commits: the chain move, then the apps on it. `core/src/io/pdfFinding/` holds the download rule (BC39), the resolvers in `resolvers/direct/` and `resolvers/learning/`, `resolvePdf` and `makeResolveContext`. The browser keeps only its tab fetch, helper tab and tab probe in `capture/tab/`. The PMC proof-of-work code had no caller and is deleted; pdf-finding step 5 can bring it back from git. The four Q2 resolvers are wired in (BC38). A learner's whole record must pass `sameWork` before any id or copy it offers is used. Semantic Scholar sends the DOI slash unencoded. `core/src/io/networkImport/` is the network import the terminal had; the terminal and the new VS Code "Add Paper by DOI or Link…" command share it (BC41). `DEFAULT_CONTACT_EMAIL` lives in core. The chain skips supplementary-material links (`MediaObjects`, `_ESM.pdf`, `/suppl/`, `downloadSupplement`, `supplementary`): on a live terminal run, OpenAlex offered a Nature supplement as the PDF of `10.1038/nature12373`. Live runs on an isolated library fetched arXiv `1706.03762` and PLOS `10.1371/journal.pone.0000308`. The neutral-runtime baseline goes from 45 to 56. VS Code `registerCommands.ts` (341 lines) and `extension.ts` (525) grew by 6 and 5 lines, which S10.3 and S10.4 split.
- 2026-10-09 17:03 S6.4 done: core `io/` is `import/`. It has three new folders: `metadata/` (the record shape, merge rules, year and field values; a leaf with `identifiers/`), `registries/` (`http`, `text`, `works/`, `books/`) and `lookup/` (confirm an identifier, search by text, candidates, enrich, title match). The PDF pipeline's `pdf/` keeps eight files at its root plus `frontMatter/`, `quality/` and `parser/`, and `parse()` is split into stages under 50 lines. A fake-opener characterization test was written before the split, and registry mapper tests were added. `describeFallback` and `stripTrailingPunctuation` had no callers and are deleted. Core size violations go from 17 to 10. Left separate on purpose, because merging would change behaviour: registry fetch (12 s, User-Agent, silent) vs `pdfFinding` `timedFetch` (8 s, logged); `stripHtml` vs `decodeEntities`; `normalizeForMatch` vs `titleKey`; `buildCiteKey` vs `makeCiteKey`; `isPdfBytes` vs the parser's header check.
- 2026-10-10 04:00 S6.5 done: `core/src/import/node/` holds `createPdfjsLoader` (memoized: `pdf.mjs`, then the in-process worker; its `getDocument` applies BC42), the Electron shims and the disk data factory (both only with `electronShims`), `loadNativeCanvas` (cached, never `__filename`), `nativeRenderOptions` and `NodePdfOpener`, all exported through `@labshelf/core/node`. VS Code builds one loader in `pdf/hostPdfServices.ts`, together with the OCR engine and text-layer factories that left `extension.ts` (528 → 492 lines). The terminal opener and thumbnail worker use core. The shim never reads a getter `navigator`, because Node prints a migration warning on that read. The pdf.js mocks and `sample-valid.pdf` moved to core; the VS Code parser tests that early-returned on a missing fixture are gone. knip ignores `@napi-rs/canvas` and the terminal's `pdfjs-dist`, which load only at runtime. Verified on isolated copies: the extension host imports a text PDF and adds arXiv `1706.03762` with its PDF, and the terminal renders thumbnails through `thumbnailWorker.mjs` with `pdftoppm` hidden. Not verified: OCR of an image-only PDF in the extension host stalls after "Starting OCR worker", the same at `HEAD` before this step; needs its own investigation.
- 2026-10-10 05:20 Session 8 finish: the app docs describe the VS Code "Add Paper by DOI or Link…" command, the terminal's network import and the browser's capture glue; pdf-finding.plan.md points at core `import/pdfFinding/` and marks its step 1 done. No acceptance criterion closes this session: A5 gains identifier detection and the PDF resolver chain, and A4 holds for `import/`.
