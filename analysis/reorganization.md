# Reorganization context

Scope: how to regroup the LabShelf monorepo into fewer, larger, single-concept modules, which duplicates and helpers to fold into shared core modules, and in what order to execute it. Facts come from `analysis/labshelf.db` (schema and clone tiers in `analysis/README.md`); judgments are marked as such below. No product code was changed.

## 0. Method and limits

| Item | Computed (SQL on `labshelf.db`) | Judged or read |
|---|---|---|
| Counts, medians, barrels, `<40 lines` shares (1) | yes | no |
| Fragmentation hotspots (1.3) | yes (metric below) | the cut-offs (nbr 8..50, tiny share >= 0.3) |
| Module grouping (2) | communities, `file_edges`, `import_names` fan-in | names, grouping of qmd, spaces, templates, typst and ui (from names and sizes, not graph-verified), target file counts (estimates) |
| Duplicates (3) | `clone_families`, `homonyms`, `calls` caller counts | which copies are equal in behaviour (read: first member, sometimes second); about 130 inline families not read |
| Helpers (4) | `units` filters; counts by name and body check, not a census | placement and API |
| Target trees (5) | no | all judgment |
| Rules in section 6 | read from `eslint.config.mjs`, `scripts/checks/*`, `.dependency-cruiser.cjs`, `vocabulary.yaml`, architecture and rules docs | the rule changes proposed |
| Execution order (7) | test-file counts by `find` | order, risk grades, slice boundaries |

Gaps reported by the parts, still open:
- Inline families (171): about 32 read (first member only); the rest rejected as boilerplate by rule, not read. Families #20, #27, #42, #43, #52 were judged by name, size and first member; read the second member before merging.
- Caller counts are resolved calls only; callbacks (`.filter(isText)`) and destructured imports need a grep of `import_names` before a copy is deleted.
- Groupings for `qmd`, `spaces`, `templates`, `typst` and `ui` come from names and sizes; communities there were not inspected.
- Target file counts and line sizes in 2 and 5 are estimates (about 300 non-barrel core files from 1309).
- Webview entries in vscode and browser are not merged: the bundler configuration was not checked.
- Directories "without clear logic" (1.4) give counts only; the per-directory community-mix list was not produced.
- `packages/terminal` and all CSS are outside the database; terminal tests (60 files) still guard every core slice.

Only `.ts` files are in the database (no CSS, no tests, no `packages/terminal`). A helper used only by terminal or tests looks unused.



Metric (fragmentation): for a directory subtree, `files` = non-barrel files, `lines` = their lines, `tiny` = non-barrel files under 40 lines, `excess = files - ceil(lines / 200)` (files that would disappear if the subtree were packed in ~200-line modules). Hotspots are chosen greedily by `excess` among directories with 8 to 50 non-barrel files and tiny share >= 30%, never nested in a hotspot already picked.

## 1. Current map

### 1.1 Totals

| Package | Files | Barrels | Lines | Median (all) | Median (non-barrel) | Non-barrel < 40 lines |
|---|---|---|---|---|---|---|
| core | 1573 | 264 | 75222 | 35 | 43 | 604 / 1309 (46%) |
| vscode | 388 | 69 | 19182 | 31.5 | 42 | 152 / 319 (48%) |
| browser | 304 | 52 | 15274 | 36.5 | 43.5 | 116 / 252 (46%) |
| all | 2265 | 385 (2634 lines) | 109678 | 34 | 43 | 872 / 1880 (46%) |

- Size bands of the 1880 non-barrel files: 272 have >= 100 lines, 41 have >= 200, 1 has >= 300 (the 300-line eslint limit is never the binding constraint today; the real pressure is the other way).
- Directories: 407. Depth 3+: 148. Leaf directories (no subdirs): 288, of which 87 hold at most 2 non-barrel files and 67 of those hold under 120 lines in total (folders that exist to satisfy `lint:dirs` "min 2 files" rule or the index rule). Directories with <= 3 non-barrel files: 169; 4 to 8: 198; 9 to 25: 37; > 25: 0. Average 4.6 non-barrel files per directory.
- Directories with only an `index.ts` plus subdirectories: 9. Pass-through (no files, one subdir): 1. 60 directories are more than 30% barrels.
- Runtimes (files / lines): core neutral 1037 / 47598, core dom 299 / 17006, core node 228 / 10112, core worker 9 / 506; vscode vscode-host 294 / 16008, node 68 / 2690, webview 26 / 484; browser dom 280 / 13768, worker 18 / 1011, content-script 6 / 495.

### 1.2 Per domain (files include barrels; median and `<40` over non-barrel)

| Domain | Files | Barrels | Lines | Median | <40 lines | Units | Lines/unit |
|---|---|---|---|---|---|---|---|
| core/writing | 268 | 50 | 10794 | 35 | 117 (54%) | 1302 | 8 |
| core/reader | 141 | 22 | 9084 | 65 | 32 (27%) | 1008 | 9 |
| core/libraryUi | 154 | 30 | 8568 | 54 | 45 (36%) | 1219 | 7 |
| core/import | 162 | 20 | 8222 | 43 | 63 (44%) | 709 | 12 |
| core/collab | 134 | 21 | 7302 | 47 | 47 (42%) | 1062 | 7 |
| core/library | 121 | 20 | 4950 | 38 | 54 (53%) | 516 | 10 |
| core/latex | 104 | 17 | 4219 | 29 | 54 (62%) | 394 | 11 |
| core/templates | 80 | 10 | 4061 | 47.5 | 31 (44%) | 452 | 9 |
| core/typst | 48 | 5 | 3128 | 58 | 12 (28%) | 224 | 14 |
| core/spaces | 64 | 14 | 2736 | 38.5 | 25 (50%) | 470 | 6 |
| core/helper | 54 | 10 | 2440 | 46.5 | 17 (39%) | 274 | 9 |
| core/qmd | 31 | 6 | 1961 | 62 | 10 (40%) | 211 | 9 |
| core/relay | 46 | 7 | 1802 | 37 | 21 (54%) | 186 | 10 |
| core/ui | 48 | 8 | 1753 | 29 | 24 (60%) | 134 | 13 |
| core/share | 30 | 5 | 1157 | 48 | 9 (36%) | 122 | 9 |
| core/ai | 25 | 5 | 982 | 33 | 12 (60%) | 71 | 14 |
| core/bridge | 15 | 2 | 851 | 60 | 6 (46%) | 86 | 10 |
| core/nativeHost | 16 | 3 | 625 | 45 | 6 (46%) | 47 | 13 |
| core/model | 9 | 1 | 217 | 27 | 6 (75%) | 10 | 22 |
| core/logging | 5 | 2 | 146 | 45 | 1 (33%) | 18 | 8 |
| core/ports | 8 | 1 | 92 | 12 | 7 (100%) | 0 | 0 |
| core/encoding | 5 | 1 | 59 | 10.5 | 4 (100%) | 9 | 7 |
| core/hash, node, dom, (root) | 5 | 4 | 73 | | | 1 | |
| vscode/writing | 191 | 31 | 8996 | 39.5 | 80 (50%) | 1115 | 8 |
| vscode/libraryUi | 39 | 7 | 2026 | 33.5 | 17 (53%) | 287 | 7 |
| vscode/collab | 28 | 6 | 1660 | 70 | 5 (23%) | 258 | 6 |
| vscode/activation | 22 | 3 | 1385 | 53 | 7 (37%) | 189 | 7 |
| vscode/command | 13 | 1 | 1256 | 85.5 | 1 (8%) | 143 | 9 |
| vscode/library | 17 | 4 | 912 | 72 | 4 (31%) | 96 | 10 |
| vscode/reader | 12 | 3 | 709 | 39 | 5 (56%) | 54 | 13 |
| vscode/latex | 16 | 3 | 590 | 31 | 7 (54%) | 85 | 7 |
| vscode/spaces, relay, storage, share, ui, webview, logging, (root) | 51 | 14 | 1648 | 12 to 44 | | | |
| browser/libraryUi | 53 | 9 | 2301 | 38.5 | 23 (52%) | 484 | 5 |
| browser/writing | 48 | 9 | 2152 | 48 | 17 (44%) | 292 | 7 |
| browser/storage | 36 | 5 | 1942 | 44 | 14 (45%) | 332 | 6 |
| browser/collab | 18 | 3 | 1465 | 57 | 4 (27%) | 277 | 5 |
| browser/helper | 22 | 6 | 1185 | 57.5 | 7 (44%) | 174 | 7 |
| browser/background | 18 | 3 | 1011 | 62 | 5 (33%) | 113 | 9 |
| browser/capture | 14 | 2 | 742 | 40.5 | 5 (42%) | 56 | 13 |
| browser/options, content, popup, reader, relay, library, libraryPage | 59 | 8 | 3066 | 24 to 144 | | | |
| browser/platform | 16 | 3 | 492 | 21 | 9 (69%) | 30 | 16 |
| browser/typst, latex, spaces, import, templates, ui, share, types | 30 | 7 | 918 | 10 to 110 | | | |

Reading: lines per unit is 5 to 9 almost everywhere, so a 100 to 400 line module is 12 to 50 functions; the code is already small-function style, only the file split is too fine. `core/writing`, `core/latex`, `core/library`, `core/ui` and `core/ai` have > 50% of their files under 40 lines. `core/ports` (7 of 8 files < 40 lines, 92 lines in total) and `core/encoding` are small by nature.

### 1.3 The 20 worst fragmentation hotspots (metric above)

| # | Directory | Files | Lines | Avg | < 40 lines | Barrels | Excess |
|---|---|---|---|---|---|---|---|
| 1 | core/import/pdfFinder | 47 | 2210 | 47 | 27 (57%) | 5 | 35 |
| 2 | core/writing/project | 36 | 1205 | 33 | 28 (78%) | 7 | 29 |
| 3 | vscode/writing/preview | 39 | 1869 | 48 | 22 (56%) | 6 | 29 |
| 4 | core/helper/node | 34 | 1779 | 52 | 15 (44%) | 8 | 25 |
| 5 | core/latex/toolchain | 26 | 1173 | 45 | 16 (62%) | 4 | 20 |
| 6 | core/ui/dom | 24 | 982 | 41 | 16 (67%) | 5 | 19 |
| 7 | vscode/writing/build | 24 | 835 | 35 | 17 (71%) | 3 | 19 |
| 8 | core/latex/build | 25 | 1297 | 52 | 14 (56%) | 4 | 18 |
| 9 | core/writing/citations | 18 | 676 | 38 | 11 (61%) | 1 | 14 |
| 10 | core/library/mutations | 18 | 880 | 49 | 7 (39%) | 3 | 13 |
| 11 | core/library/conflicts | 16 | 693 | 43 | 10 (63%) | 4 | 12 |
| 12 | core/import/registries | 16 | 781 | 49 | 6 (38%) | 1 | 12 |
| 13 | core/library/node | 17 | 844 | 50 | 12 (71%) | 3 | 12 |
| 14 | core/libraryUi/dom/list | 20 | 1477 | 74 | 6 (30%) | 4 | 12 |
| 15 | core/templates/node | 15 | 540 | 36 | 11 (73%) | 2 | 12 |
| 16 | browser/libraryUi/editorArea | 17 | 912 | 54 | 9 (53%) | 1 | 12 |
| 17 | core/latex/source | 14 | 431 | 31 | 10 (71%) | 3 | 11 |
| 18 | core/reader/dom/preview | 17 | 1165 | 69 | 6 (35%) | 3 | 11 |
| 19 | core/collab/mirror | 16 | 1059 | 66 | 5 (31%) | 2 | 10 |
| 20 | core/spaces/dom | 15 | 893 | 60 | 7 (47%) | 6 | 10 |

Too big for the cap and therefore replaced by their children above: `core/reader/dom` (77 files, 5673 lines, excess 48), `core/libraryUi/dom` (73, 5277, 46), `core/writing/allProjects` (39, 2515, 26; only 28% tiny), `core/typst/language` (33, 2554, 20; 24% tiny, large files are fine there).

### 1.4 Directories without clear logic (how to list them, counts known)

| Kind | Count | Query (run it for the list) |
|---|---|---|
| Leaf dir with <= 2 non-barrel files and < 120 lines in total | 67 | `select path from dirs d where subdirs=0 and (select count(*) from files f where f.dir=d.path and is_barrel=0)<=2 and lines<120` (on `dirs.lines`, which counts barrels too, add the barrel filter) |
| Index-only dir with subdirs | 9 | `files=1 and subdirs>0` and the file is a barrel |
| Pass-through (no files, one subdir) | 1 | `files=0 and subdirs=1` |
| Dir where > 30% of the files are barrels | 60 | per-dir barrel share |
| Dir whose files fall in different level-0 communities | not computed | join `files` to `communities` (scope = package, level = 0) and count distinct communities per dir |

Community shape (level 0, finest; level 2 merges across domains and is too coarse to use): core 207 communities for 1309 files (17 single-file, 109 of 2 to 4 files, 67 of 5 to 12, 7 of 13 to 25, 7 above 25, largest 116), mean dir purity 0.71; vscode 64; browser 55. In core, 28 communities with >= 5 files have dir purity < 0.5 (576 files, 32324 lines): these are the cross-directory clusters to inspect first (query 10 of the README with `scope='core' and level=0 order by dir_purity`).

## 2. Candidate modules

A module is one file of 100 to 400 lines (or a directory when it holds several real modules) that owns one concept and exposes a small public API; module names reuse existing vocabulary terms (`scripts/checks/vocabulary.yaml`). Core modules (2.1) were grouped from level-0 communities and fan-in, VS Code (2.2) and browser (2.3) modules mostly follow current folders, because their communities already sit inside one folder. Each app part also lists code that belongs in core; those items are the input of the last slice in section 7.

### 2.1 Core modules

Conventions used below. "Files" are non-barrel files, "L" is lines. `cN` is a level-0 community id of scope `core` (`communities`/`community_summary`, 207 communities); "purity" is `dir_purity`. Public API lists the most-used non-type exports imported from outside the domain (`import_names`, distinct importing files in brackets). Runtime column: N = neutral (domain root), `node/`, `dom/`, `worker/`. A module is one file of 100-400 lines unless the table says "dir"; a module becomes a directory only when it exceeds about 5 files after merging (large DOM surfaces). Approximate target counts are lines / 200-250, rounded; they exclude barrels.

Reading the communities: level 0 follows call and import weight, not folders. Of the 42 communities with 8+ files, 13 have purity < 0.35 (they mix 3+ directories or cross a domain boundary). Those are listed per module as "crosses"; they are the places where the merge needs a decision, not a move.

| Cross-domain community | Files / L | Spans | Decision |
|---|---|---|---|
| c23 | 116 / 7412 | `ui/dom/widgets(/page)`, `templates/dom`, `reader/dom/chrome`, `writing/allProjects/dom`, `ui/dom/settings` | The DOM element and widget builders (`renderElement` 104 users, `renderIcon` 82). One module `ui/dom/elements` plus widgets; surface code in `templates`, `reader`, `writing` stays in its domain and imports it. Not a module itself. |
| c10 | 45 / 2213 | `writing/conflict(/node)`, `library/conflicts(/node)` | One conflict-detection module in `library`; `writing/conflict` shrinks to the project adapter. |
| c15 | 45 / 2766 | `import/registries`, `import/pdf`, `import/search`, `import/metadata` | Real cluster (registries return the records that pdf text and search merge); keep in `import`, split by concept below, not by directory. |
| c4 | 49 / 1865 | `writing/citations`, `writing/project`, `project/mutation`, `project/folder` | Project reads feed citation scans: `writing/project` and `writing/citations` merge their shared read context (`projectReadContext`, fan-in 32) into `writing/project/sources`. |
| c70, c71 | 9 + 8 | `writing/build/node`, `latex/build`, `typst`, `helper/node/build` | Build orchestration: queue and result handling in `writing/build`; the helper only adapts. |
| c114 | 11 / 518 | `share`, `share/flow`, `libraryUi/share/flow` | The sharing flows live in `share`; `libraryUi/share` (9 files, 725 L) and `collab/share` (10 files, 461 L; c105, c136) move there. |
| c18, c1, c96, c99 | 38, 35, 13, 9 | `libraryUi/{store,protocol,dom,viewModel}` and `libraryUi/dom/{list,detailPane,sidebar,flows}` | c18 is the store-protocol-viewModel core of one concept; c1 is the list-and-detail DOM. Keep as two modules (state, surface). |
| c6, c8, c3, c25 | 12, 11, 11, 8 | `reader/sidecar` + `writing/citations`; `logging` + `library/externalChange` + `helper/node/log`; `library/mutations` + `model`; `writing/bibliography` + `library/paper` | Small mixed clusters around `model` types and shared records; they dissolve once `model` and the shared modules of section 4 exist. |

#### library (101 files, 4950 L incl. barrels; target about 20 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `layout` | Where things live in a library and a device-local folder. | `library/*.ts` root (5, 263 L), `model/` (7, 558), `paperFiles/` (5, 121), `node/deviceState/` (3, 121) | N + `node/` | `PAPERS_DIR` [39], `createLibraryLayout` [17], `PDF_FILE` [11], `createDeviceLocalLayout` [9] |
| `record` | `metadata.yaml` to record, cite keys, tags, folder names, reading status. | `paper/` (12, 414), `folder/` (3, 220), `readingStatus/` (1, 16); c5, c25 | N | `deriveParentDir` [13] (move to `core/path`) |
| `mutations` | Import, move, rename, trash, update fields, text-layer verdicts; one write path. | `mutations/` (8, 441), `mutations/import` (7, 325), `textLayer` (3, 114), `writeRecords/` (3, 121); c3 | N | `importPaper`, `movePaper`, `renamePaper`, `trashPaper`, `updateFields`, `recordTextLayer` |
| `conflicts` | Detect and describe sync conflicts for papers, projects and spaces. | `conflicts/` (6, 217) + `node/` (5, 267) + `project/` (4, 173) + `spaces/` (1, 36), `externalChange/` (3, 119), `syncGuide/` (2, 117), `writing/conflict` (4+6+2+1 files, 196+424+120+64 L); c10 (crosses) | N + `node/` | `detectConflicts`, `describeConflict` |
| `search` | Full-text and field search over records. | `search/` (6, 301), `search/text` (3, 113) | N | `searchLibrary` |
| `node/` | Library location and atomic file writes on disk. | `node/` (6, 233), `libraryLocation/` (8, 490) | node | `resolveLibraryDir`, `writeFileAtomic` [16] (move to `core/files`) |

Current 101 files (excluding the 18 shared leaf barrels) become 6 modules of 1 to 5 files, about 20 files. `posixPathOps` [22] and `writeFileAtomic` [16] are library exports used everywhere; they belong to the shared path/files modules (reserved below).

#### import (142 files, 8222 L; target about 34 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `identifiers` | Detect and normalize DOI, arXiv, ISBN, URL identifiers. | `identifiers/` (7, 300); c17 | N | `extractDoi` [6], `extractArxivIdentifierFromUrl` [4], `normalizeArxivIdentifier` [3] |
| `registries` | CrossRef, arXiv, Semantic Scholar and others behind one lookup contract. | `registries/` (16, 781), `metadata/` (5, 182); c15 | N | `lookupMetadata`, `DEFAULT_CONTACT_EMAIL` [2] |
| `search` | Title and query search across registries, merged and ranked. | `search/` (6, 353); c15 | N | `searchPapers` |
| `pdf` | PDF text and metadata extraction. | `pdf/` (14, 937), `pdf/parser/` (5, 551); c15 | N | `readPdfMetadata`, `extractPdfText` |
| `ocr` | Local OCR fallback. | `node/ocr/` (4, 512), `node/` (11, 453) | node | `runOcr` |
| `landing` | Parse a publisher landing page into a record, including authors. | `landing/` (5, 426), `landing/author/` (5, 165) | N | `parseLandingPage` |
| `paper` | Resolve and merge candidate records into one paper. | `paper/` (8, 427), `flow/` (4, 297) | N | `resolvePaper`, `mergeRecords` |
| `bibtex` | BibTeX entries and the citation map. | `bibtex/` (2, 167), `citationMap/` (3, 266) | N | `BibtexService` [2], `createBibtexEntry` [2] |
| `pdfFinder` | Find and download the open PDF of a paper (detail below). | `pdfFinder/` (47, 2210); c2, c49 | N | `findPaperPdf`, `fetchPdf` [3] |

Fan-in: `pdfResolver.ts` 37, `publisherRule.ts` 10, `env.ts` 10, `fetchPdf.ts` 7 - the rest of pdfFinder is near-private.

**import/pdfFinder, 47 files to 9 (hotspot 1).** c2 holds resolvers 14, engine 7, root 6 (34 files); c49 holds the publisher platform rules (11 files, purity 0.73).

| Target file | Absorbs (current files) | L now |
|---|---|---|
| `finder.ts` | `findPaperPdf`, `resolvePdf`, `pdfResolver` (fan-in 37), `createResolveInput`, `env`, `urlParts` | 6 files, 283 |
| `client.ts` | `client/*` (fetchPdf 138, botCheck, createProxiedUrl, fetchOutcome, hops, signatures, supplementary) | 7 files, 323 |
| `engine.ts` | `engine/findStage`, `downloadStage`, `signInStage`, `createDeadline`, `limits`, `helperTabs` | 6 files, 464 |
| `hostPacer.ts` | `engine/hostPacer` joined with `timedFetch` (host pacing and timeouts) | 2 files, 90 |
| `resolvers/openAccess.ts` | unpaywall, pmc, europePmc, openalex, publisher, customResolver | 6 files, 258 |
| `resolvers/indexes.ts` | arxiv, crossref, semanticScholar, addIdentifiers | 4 files, 108 |
| `resolvers/matching.ts` | matchPaper, titleTwin, deriveCandidateVersion, pageHint | 4 files, 133 |
| `rules.ts` | `rules/` root: createDoiPathRule, findRule, publisherRule (fan-in 10), scholarlyHost | 4 files, 126 |
| `platforms.ts` | `rules/platforms/*` (atypon, commercialPublishers, openAccess, physics, societies, springer, wiley) as one data table | 7 files, 406 |

Result: `pdfFinder/` with 9 files and one `resolvers/` subfolder (or flat with a `resolvers*` prefix), no 5-barrel tree; platforms stay a table so adding a publisher is a one-line change.

#### reader (119 files, 9084 L; target about 38 files, 77 of the 119 are in `dom/`)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `protocol` | Reader/host messages, preferences, citation formats. | root (12, 678), `protocol/` (4, 230); c53 | N | `PROTOCOL_VERSION` [2] |
| `host` | The host controller that answers reader messages for all hosts. | `host/` (8, 560) | N | `ReaderHostController` [3] |
| `sidecar` | Per-paper data store and reading state. | `sidecar/` (4, 405); c6 | N | `PaperSidecarStore` [8], `compareAnnotations` [2] |
| `navigation` | Pure page, position and history logic. | `navigation/` (7, 514) | N | `derivePreviewProblems` [2] |
| `text` | Text layer, selection, search anchors. | `text/` (6, 852) | N | - |
| `dom/session` | Session and startup of the page. | `dom/session` (8, 490), `startup` (8, 456), root (3, 177) | dom | `PerfMarks` [2] |
| `dom/chrome` | Toolbar, menus, zoom. | `chrome/` (8, 718); in c23 (crosses) | dom | - |
| `dom/hover` | Citation hover card. | `hover/` (7, 651) + `citations/` (3, 183) + `card/` (4, 183); c143 | dom | - |
| `dom/preview` | Preview store, header, footer (hotspot 18). | `preview/` (8, 457) + `header/` (4, 220) + `footer/` (5, 488) | dom | `createPreviewStore` [3] |
| `dom/navigation` | Outline, thumbnails, page controls. | `dom/navigation` (7, 573) | dom | - |
| `dom/sidebar` | Annotations and details side panel. | `sidebar/` (5, 560) | dom | - |
| `dom/highlights` | Highlights, text, elements. | `highlights` (2, 138), `elements` (2, 120), `text` (3, 259) | dom | - |

Targets: the pure side (31 files, 3 239 L) to 9 files; `dom/` (77 files, 5 673 L) to about 22 files: session 3, chrome 3, hover 3, preview 3, navigation 2, sidebar 3, highlights 3 (plus one folder per module over 5 files).

#### libraryUi (124 files, 8568 L; target about 36 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `protocol` | Host message protocol and in-page loopback channel. | `protocol/` (5, 317), `details/protocol` (2, 34), root (8, 389); c18 | N | `createLoopbackTransport` [7], `isShareMessage` [4] |
| `store` | View store and prefs. | `store/` (4, 444); c18 | N | - |
| `viewModel` | List rows, scope, sorting, keymap, PDF wording. | `viewModel/` (11, 409), `copyRequest/` (2, 151); c18, c5 | N | `formatPdfSourceLabel` [5] |
| `citationMap` | Citation-map data and view. | `citationMap/` (3, 162), `dom/citationMap` (1, 186) | N + dom | - |
| `dom/list` | The paper list with tray, tree and window. | `list/` (8, 709) + `tray` (5, 292) + `tree` (4, 162) + `window` (3, 314); c1 | dom | - |
| `dom/detailPane` | Detail pane with header and tabs. | `detailPane/` (5, 493) + `header` (4, 248) + `tabs` (6, 277), `details/dom` (5, 365); c1 | dom | `askNoPdf` [2] |
| `dom/sidebar` | Library sidebar with spaces. | `sidebar/` (7, 891) + `spaces` (3, 154); c96 | dom | - |
| `dom/editorArea` | Editor area (hotspot 16 in browser). | `editorArea/` (5, 533) | dom | - |
| `dom/flows` | Paper and PDF flows, menus, header, shell, drag. | `flows` (5+2+2, 325), `menu` (2, 101), `header` (2, 133), `shell` (2, 113), `drag` (2, 45), root (5, 301); c99 | dom | `renderMuted` [4] |

Moves out: `share/` (9 files, 725 L) to `share`. Targets: protocol 3, store 2, viewModel 3, citationMap 2, list 5, detailPane 4, sidebar 3, editorArea 2, flows 6, plus shell = about 30 (dom/ 73 files, 5 277 L to about 20).

#### writing (218 files, 10794 L; target about 50 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `project` | The project file, listing, mutations, build root, export (detail below). | `project/` (36, 1205), `projectValue/` (7+1, 319), `service/` (4, 162) | N + `node/` | `PROJECT_FILE` [13], `parseProjectFile` [5], `listProjectFiles` [5] |
| `citations` | Cite-key scan, completion, bibliography sync, backlinks, quotes. | `citations/` (18, 676), `bibliography/` (6, 379), `quotes/` (4, 168), `readingList` (1, 47); c4, c25 | N | `derivePapersByCiteKey` [7], `parseBibEntries` [5] |
| `build` | Build queue and results; typst/latex adapters. | `build/` (6, 123) + `node/` (4, 272); c70 | N + `node/` | `ProjectBuildQueue` [5], `LATEX_ENGINES` [6] |
| `allProjects` | All-projects surface (library of projects). | `allProjects/` (39, 2515); c137, c187-c191 | N + dom | - |
| `checks` | Pre-build checks and checklist. | `checks/` (8+3+1, 509), `checklist/` (7+2, 640) | N + `node/` | - |
| `history` | Versions and history. | `history/` (6+1+2+2, 544), `versions/` (9+2, 702); c125, c126 | N + `node/` | - |
| `search` | Project text search. | `search/` (8+2+2, 570) | N + dom | - |
| `synctex` | Source/PDF sync. | `synctex/` (6, 337) | N | - |
| `snippet`, `figures`, `outline`, `text` | Snippets, figures, outline, text helpers. | `snippet` (6, 221), `figures` (4+1, 150), `outline` (3, 47), `text` (4, 70) | N | - |

**writing/project, 36 files (+7 in projectValue) to 6 (hotspot 2).** `projectEntry` (fan-in 63), `projectFile` (95), `projectReadContext` (32) and `readOptionalText` (13) are the core of every writing feature.

| Target file | Absorbs | L now |
|---|---|---|
| `projectFile.ts` | projectFile (192), projectEntry, projectId, userSettings (86), readProjectEntry, `projectValue/*` | 6 + 8 files, about 450 |
| `projectReads.ts` | `folder/*` (6 files), listedPapers, listBibliographyFiles, openSources, `node/nodeProjectReads` | 10 files, about 240 |
| `projectMutations.ts` | `mutation/*` (7 files, c4), createProjectId, removeProjectForever | 7 files, 183 |
| `buildRoot.ts` | `buildRoot/*` (5 files, 139+31) | 5 files, 170 |
| `projectRegistry.ts` | `deviceLocal/*` (3 files, 122), parseJsonObject | 3 files, 122 |
| `projectExport.ts` + `node/exportProject.ts` | createArxivBundle, createInstallPlan, exportFiles, installReport, pandocCommand, `node/exportWithPandoc`, removeFlatBuildFiles | 8 files, about 260 |

`allProjects` (39 files, 2 515 L, 28% tiny) is not a hotspot but spans c4, c137, c153, c154, c187-c191 and the `dom/` list tray; target 12 files: library (9 files, 512 L, c153/154) 2, protocol and viewModel (4, 191) 1, dom list/tray/detailPane (23, 1 683) 8, root 1. Writing totals: 218 files to about 50 (project 6, citations 6, build 3, allProjects 12, checks 3, history 4, search 3, synctex 2, rest 11).

#### latex (87 files, 4219 L; target about 18 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `toolchain` | Find, install and verify a TeX distribution (hotspot 5). | `toolchain/` (26, 1173); c57, c58, c169, c170 | N + `node/` | `findExecutable` [3], `formatEngineLabel` [5] |
| `build` | Build commands, preview and section builds, problem classes (hotspot 8). | `build/` (25, 1297); c60, c62-c65 | N + `node/` | `createLatexBuildCommand`, `buildResult` [23 files] |
| `source` | Scan LaTeX sources, commands, project layout (hotspot 17). | `source/` (4+6+4, 431); c65, c66, c67 | N | `scanLatexSource` [7], `readLatexProjectSources` [6] |
| `catalog` | Command and environment catalog. | `catalog/` (8, 342) | N | `LATEX_COMMANDS`, `LATEX_ENVIRONMENTS` [2] |
| `log` + `hover` | Log parsing and hover help. | `log/` (3, 315), `hover/` (3, 149) | N | - |
| `biber` | Bibliography backend. | `biber/` (5+3, 364); c59, c61 | N + `node/` | `BIBER_FLAG` [2] |

Targets: toolchain 26 to 6 (`managedTex.ts` with installTexLive, installTinyTex, profile, layout, tlmgr, lock and keyring merged in 2 files; `systemTex.ts`; `verify.ts` for signature and download; `toolchain.ts` for the provider contract); build 25 to 6 (`build.ts`, `problems.ts`, `sectionPlan.ts`, `sectionState.ts`, `node/run.ts`, `node/preview.ts`); source 14 to 3; catalog 8 to 2; log and hover 6 to 2; biber 8 to 2.

#### collab (113 files, 7302 L; target about 30 files)

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `doc` | Shared document: binding, model, shared files, comments, index doc. | `doc/` (5, 465), `binding/` (6, 585), `model/` (9, 348), `comments/` (8, 455); c34 | N | `readFileText` [3], `readShareIndexDocFiles` [3], `COMMENTS_PATH` [2], `addThread` [2], `NormalizedText` [2] |
| `mirror` | Mirror a shared project to disk with leases (hotspot 19). | `mirror/` (13, 953) + `fileSystem` (3, 106); c121, c130 | N | - |
| `relays` | Relay sync, selection, follow and holds. | `relays/` (16, 1228), `transport/` (1+5, 335); c118 | N | - |
| `session` | A share connection and its device state. | `session/` (8, 568), `deviceState/` (5, 366) + `node/` (2, 92); c34 | N + `node/` | - |
| `peer` | Peers and presence. | `peer/` (7, 485), `presence/` (2, 180) | N | - |
| `invite` | Invite and share keys. | `invite/` (2, 108), `shareKey/` (4, 137) | N | - |
| `share flows` | Moved out: `collab/share` (10 files, 461 L; c105, c136) goes to `share`. | | | `createProjectShareMenuEntries` [3], `runJoinProjectDialog` [3] |
| `dom` | Collab DOM bits. | `dom/` (6, 190) | dom | - |

Targets: doc 28 files (1 853 L) to 8; mirror 16 to 5 (`projectMirror` 246 L absorbs the 9 files below 60 L, keep `projectLease`, `pathQueue`, `textMirror`, `mirrorFileSystem`); relays 22 to 6 (`relaySync` 270 absorbs options/cursors/docLane/docPuts/holds/held; `relaySelector` 217 absorbs probe and follow; `relayWatch`, `presence`, `transport`, `list`); session 15 to 4; peer 9 to 3; invite 6 to 2; dom 6 to 2. 

#### helper, bridge, nativeHost, relay, share, ai, qmd

| Domain / module | Purpose | Absorbs (files, L) | Runtime | Public API | Target |
|---|---|---|---|---|---|
| `helper/protocol` | Host name, version, messages. | root (8, 525), `template/` (2, 63); c56 | N | `HELPER_HOST_NAME` [3], `PROTOCOL_VERSION` [3], `parseHelperMessage` | 3 |
| `helper/node` | The helper process: connection, handlers, transport, projects, build, privacy check, log. | `node/` (34, 1779); c71, c192, c193, c194, c196 (hotspot 4) | node | `runHelperScriptHost` | 8 (projects 1, build 1, connection+transport 1, handlers 2, privacy+log 1, root 2) |
| `bridge` | Browser-bridge protocol and host. | root (6, 285), `node/` (7, 552) | N + node | `BridgeError` [5], `resolveBridgeLogPath` [3], `resolveInLibrary` [3], `BRIDGE_PROTOCOL` | 5 |
| `nativeHost` | Installing native host manifests. | `node/` (9+3, 409), root (1, 22); c165 | node | `installNativeHost` [2], `refreshNativeHost` | 3 |
| `relay/client` | Client, HTTP, connection, account, OAuth. | `client` (9, 403), `http` (4, 99), `connection` (3, 233), `account` (8, 228), `oauth` (6, 252); c110 | N | `connectRelayAccount` [2], `createRelayAccountStore` [2], `RELAY_PATH` | 7 |
| `relay/worker` | The Cloudflare Worker (neutral tsconfig). | `worker/` (8, 495) | worker | `readRelayWorkerScript` [4] | 3 |
| `share` | All user-facing sharing flows (see c114). | root (11, 630), `flow/` (5, 203), `http/` (3, 81), `dom/` (5, 164), `node/` (1, 33), plus `libraryUi/share` (9, 725), `collab/share` (10, 461) | N + dom + node | `runShareFolderDialog` [3], `importShareLink` [2], `reportFailure` [5] | 9 (from 44) |
| `ai` | Embeddings, chunking, retrieval, ingestion, `AiService`. | root (4, 202), `chunk` (4, 277), `embedding` (5, 130), `service` (3, 103), `node/` (4, 235); c11, c14 | N + node | `AiService` [4], `createAiService`, `findSimilarPapers` | 6 |
| `qmd` | Quarto editor items, conflicts, cell output. | `editor` (9+2, 953), `items` (10, 595), `conflict` (2, 294), `cellOutput` (2, 77); c33 | N | `mergeItemFiles` [1] | 9 |

#### typst, templates, spaces

| Module | Purpose | Absorbs | Runtime | Public API |
|---|---|---|---|---|
| `typst/language` | Syntax, project and language service. | `language/` (3, 349) + `syntax` (6, 619) + `project` (3, 162); c31, c42, c43 | N | `createTypstLanguageService` [2], `scanTypstHeadings` [3] |
| `typst/stdlib` | Standard library signatures as data (low fragmentation, keep as tables). | `typstStdlib/` (16, 1145) + `layout` (5, 279); c206, purity 0.76 | N | - |
| `typst/node` | Compiler host, package store, session. | `node/` (5, 298), root (5, 221) | node | `TypstCompilerHost` [2], `TypstPackageStore`, `TypstSession`, `TYPST_VERSION` [2] |
| `templates/manifest` | Template manifest, categories and checks. | `templateManifest/` (5, 350), root (9, 310); c89 | N | `TEMPLATE_CATEGORIES` [2], `checkTemplateForPublish` [2], `deriveTemplateTreeProblem` [2] |
| `templates/sources` | Template sources over file systems. | `sources/` (7, 515), `fileSystem/` (4, 190); c12 | N | `createLibraryTemplateSources` [2] |
| `templates/node` | Catalog and node install. | `node/` (7+8, 540) ; c89, c197, c198 (hotspot 15) | node | - |
| `templates/host` | Host, client, protocol of the gallery and publish. | `host/` (7, 438), `client/` (6, 288), `protocol/` (4, 143) | N | `createGalleryHost` [2], `createPublishHost` [2] |
| `templates/dom` | Gallery and publish surfaces. | `dom/` (13, 1198); c23 | dom | - |
| `spaces/model+store` | Space model, JSON, store and mutations. | `model/` (5+4, 478), `store/` (5+5, 525); c183 | N | `SpaceStore` [6] |
| `spaces/protocol+viewModel` | Protocol and derived views. | `protocol/` (3, 208), `viewModel/` (8+2, 311), root (3, 239); c185 | N | `serveSpaces` [3], `deriveSidebarRows` [2], `SPACE_TABS` [3], `deriveSpaceChecklistProgress` [2] |
| `spaces/dom` | Catalog, frame, glossary, papers, overview. | `dom/` (15, 893) | dom | - |

Targets: typst 43 to 13 (language 4, stdlib 4, node 3, root 2); templates 70 to 17 (manifest 3, sources 3, node 4, host 4, dom 5 less overlap); spaces 50 to 12 (model 2, store 3, protocol/viewModel 3, dom 4).

#### ui, model, ports, logging, encoding, hash and shared

| Module | Purpose | Absorbs | Runtime | Public API | Target |
|---|---|---|---|---|---|
| `ui/tokens` | Design tokens and base styles. | `tokens/` (9, 508); c100, purity 1.0 | N | - | 3 |
| `ui/icons` | Icon set. | `icons/` (4, 180) | dom | `renderIcon` [82] | 2 |
| `ui/dom/elements` | Element builders. | `dom/` (2, 85), root | dom | `renderElement` [104], `findElement` [28], `escapeHtml` [31] | 2 |
| `ui/dom/widgets` | Button, menu, dialog, toast, quick input. | `widgets/` (7, 476) + `page/` (8, 171); c23 | dom | `showToast` [31], `showMenu` [19], `askInputBox` [16] | 4 |
| `ui/dom/settings` | Settings page parts and sync guide. | `settings/` (6, 162), `syncGuide/` (1, 88) | dom | - | 2 |
| `model` | Paper record, statuses, annotations, themes, colours. | `model/` (8, 201); c3, c5, c8 | N | `isPrePublication` [5], `ANNOTATION_COLORS` [3], `BIBLIOGRAPHIC_FIELDS`, `deriveVenue`, `isPdfTheme` | 4 |
| `ports` | Host interfaces. | `ports/` (7, 82) | N | types only | 2 |
| `logging` | JSON-lines format, logger, file sink. | `logging/` (2+1, 141) | N + node | `formatError` [122], `Logger` [4], `FileLogSink` [3] | 2 |
| `encoding`, `hash` | Bytes, base64, hex, SHA-256. | `encoding/` (4, 54), `hash/` (1, 15) | N | `bytesToBase64Url` [11], `bytesToHex` [8], `deriveSha256Hex` [12] | 2 |
| Shared modules (new) | `path`, `url`, `guards`, `json`, `events`, `time`, `async`, `errors`, `text`, `files` | section 4; `encoding` and `hash` are extended in place | N (`files/node/`) | `posixPathOps` [22] goes to `path`, `writeFileAtomic` [16] to `files/node` | 1 to 3 files each |

`ui` 40 files to 11. `formatError` (122 users) and `renderElement` (104) are the highest fan-in exports in core; neither should stay inside a domain barrel of a feature.

### 2.2 VS Code modules

Source: `files`, `communities` (scope `vscode`, level 0, 64 communities), `import_names`, `units.effects_transitive`. The 69 files with a NULL community are all barrels. Level-0 communities follow the folders closely (most communities sit inside one folder), so the proposed modules are mostly folder merges, not regroupings. Counts are non-barrel files / lines of the current dirs; "Target files" is after merging fragments.

| # | Module (`src/…`) | Purpose | Current dirs in (files / lines) | Communities | Runtime | Target files | Public API (used by the root or other modules) |
|---|---|---|---|---|---|---|---|
| V1 | `activation/` | Composition root: builds core services with the VS Code adapters, registers views and commands, owns the library root. | `activation` 13 / 1162, `activation/node` 6 / 223 (incl. `nativeHost`), root `extension.ts`, `helperHost.ts` 3 / 30, `logging/node` 1 / 14, `storage/node` 1 / 11 | 2, 9, 11 (part), 17 (part), 46, 54 | vscode-host + `node/` | 7 (+2 in `node/`) | `startExtension`, `HostAdapters`, `createDesktopPlatform`, `LibraryRootController`; only `extension.ts` imports `activation/node/` |
| V2 | `library/` | Paper service, library folder location and shared-library config, conflict handling, sync guide: the VS Code side of the library. | `library` 5 / 428, `library/conflicts` 2 / 157, `library/node` 4 / 231, `library/syncGuide` 2 / 96, `storage` 4 / 265, `storage/paths` 2 / 58 | 11, 15, 56, 6 (part), 12 (part) | vscode-host + `node/` | 5 (+1 `node/`) | `PaperService`, `PaperImporter`, `PaperTextLayers`, `LibraryEvents`, `resolveLibraryRoot`, `UriOfPath`, `SharedLibraryConfig` |
| V3 | `commands/` | Paper commands: import, metadata fetch, manual entry, text-layer queue, folder commands, AI commands, progress. | `command` 12 / 1256 | 7, 9, 12, 13, 14 (part) | vscode-host | 5 | `registerCommands`, `runSafely`, `ActiveServices`, `FolderCommandHost`, `createPaperPickItem` (6 other domains import it) |
| V4 | `libraryUi/` | Library sidebar, list panel, feed, detail pane, citation map and their message handlers, plus the webview entries of these views. | `libraryUi` 12 / 1015, `host` 5 / 319, `details` 5 / 304 (incl. webview 3), `webview` 6 / 215, `citationMap` 2 / 80, `spaces` 2 / 93 | 2, 8, 9, 10, 57, 60, 7 (part) | vscode-host + webview | 9 | `LibraryNode`, `createLibraryPaths`, `ListWebviewPanel`, `SelectionSources`, `registerLibrarySidebar` |
| V5 | `spaces/` | Spaces view and the add-to-space action. | `spaces` 5 / 420, `spaces/webview` 2 / 50 | 5, 42, 62, 58 (part) | vscode-host + webview | 2 | `registerSpaces`, `addToSpace` |
| V6 | `reader/` | Reader panel, the pdf.js lookup and the webview document shell. | `reader` 5 / 592, `reader/node` 2 / 85, `reader/webview` 2 / 32 | 16, 61, 46 (part) | vscode-host + `node/` + webview | 3 (+1 `node/`) | `ReaderPanel`, `ReaderPanelDeps`, `hostPdfjs`, `findPdfjs` |
| V7 | `relay/` | Relay accounts, connect/disconnect commands and progress. | `relay` 8 / 402 | 43 | vscode-host | 3 | `registerRelay`, `CONNECT_RELAY_COMMAND`, `openRelayAccounts` |
| V8 | `share/` | Share links, the share host and its webviews. | `share` 2 / 72, `share/node` 4 / 203 | 0, 47, 46 (part) | vscode-host + `node/` | 2 (+1 `node/`) | `registerShareLinks`, `serveShareOn`, `sharingWebviews`, `createVscodeShareHost` |
| V9 | `collab/` | Collaboration: shared-project editor binding, source comments, session/presence, conflict dismissal. | `collab/binding` 4 / 298, `collab/comments` 6 / 544, `collab/node` 12 / 818 (commands 3, editors 2, session 5) | 22, 23, 44, 45, 1 | vscode-host + `node/` | 4 (+3 `node/`) | `registerCollab`, `addSourceComment` |
| V10 | `latex/` | LaTeX editing support: labels, project sources, completion. | `latex` 6 / 279, `labels` 4 / 164, `project` 3 / 147 | 29, 17 (part) | vscode-host | 3 | `createProjectSourceReader`, `registerLatexEditing`, `registerLatexCommandCompletion` |
| V11 | `webview/` | Shared webview plumbing and the "bundle missing" page. | `webview` 3 / 53, `ui` 4 / 70 | 57, 58, 59, 3, 4 (part) | webview + vscode-host | 2 | `createWebviewTransport`, `createWebviewPrefs`, `renderBundleMissingHtml`, `createTabIcon` |
| V12 | `writing/commands/` | Registration of the Writing commands that belong to no sub-feature: export, insert actions, paper links, bibliography check, project item commands, build-root status. | `writing` (root) 15 / 1034 | 7, 17, 18, 31, 33, 34 (mixed) | vscode-host | 4 | `registerWriting`, `RegisterPlatformWriting`, `WritingProjects`, `findOwningProject` |
| V13 | `writing/build/` | LaTeX build, toolchain setup, include-only, project check, with its `node/` spawn code. | `build` 24 / 864 (incl. `node` 6, `toolchain` 5), `check` 3 / 104 | 18, 19, 17, 28, 30 (part), 40, 48 | vscode-host + `node/` | 5 (+2 `node/`) | `registerNodeWriting` (one Node entry), `ProjectBuilders` |
| V14 | `writing/typst/` | Typst build and language support. | `typst` 6 / 433 (incl. `node`), `writing/node` 1 / 34 | 30, 51, 18 (part) | vscode-host + `node/` | 2 (+1 `node/`) | folded into `registerNodeWriting` |
| V15 | `writing/figures/` | Figure regeneration and figure watching. | `figures` 7 / 314 (incl. `node` 2) | 4, 49, 20 (part) | vscode-host + `node/` | 2 | `watchFigureFiles` |
| V16 | `writing/history/` | Version history and versions view. | `history` 3 / 242, `versions` 5 / 320 (incl. `node` 2 each) | 52, 53, 58 (part) | vscode-host + `node/` + webview | 3 | folded into `registerNodeWriting` |
| V17 | `writing/preview/` | PDF preview: build previews, build roots, citation cards, synctex, limits, ports. | `preview` 39 / 1914 (`buildRoot` 7, `citations` 12, `synctex` 6, `limits` 4, `commands` 3) | 24, 26, 25, 22 (part), 28, 27, 21 | vscode-host | 7 | `PreviewPorts`, `createPreviewPorts`, `registerPreview` |
| V18 | `writing/citations/` | Citation completion, hover, backlinks, project values, reading lists. | `citations` 11 / 687, `projectValue` 4 / 198, `readingList` 2 / 97 | 14, 34, 41, 20 (part) | vscode-host | 5 | `registerCitationProviders` |
| V19 | `writing/projects/` | Writing sidebar: project list, project tree mirror, outline, checklist, all-projects view, session. | `sidebar` 2 / 411, `tree` 4 / 309, `outline` 6 / 176, `checklist` 4 / 480, `allProjects` 4 / 261, `session` 4 / 254 | 20, 31, 32, 35, 37, 38, 39 | vscode-host + webview | 7 | `registerWritingView`, `PlatformWriting` port |
| V20 | `writing/search/` | Project search and replace. | `search` 8 / 388 | 36, 58 (part) | vscode-host + webview | 2 | `registerSearch` |
| V21 | `writing/templates/` | Template picker for new projects. | `templates` 8 / 476 (incl. `node` 5) | 3, 50, 58 (part) | vscode-host + `node/` + webview | 2 | `registerTemplates` |

Totals: 319 non-barrel files / 18.8k lines become about 85 files (median about 200 lines), 21 modules, none above 9 files. `writing/` stays one folder with 10 sub-features because it is 47% of the app; its internals are independent (V13 to V21) and only V12 and V19 talk to many.

Notes on the runtime split:

| Rule | Consequence |
|---|---|
| Only `extension.ts` imports a `node/` folder (dependency-cruiser) | Keep `node/` as a subfolder of each of V1, V2, V6, V8, V9, V13, V14, V15, V16, V21 (2 or 3 files each); do not hoist them into one `node/` module, or the rule "neutral code sees Node only through neutral types" loses its anchor in each feature. |
| `webview/` code is bundled separately | The 21 non-barrel webview files (17 of them under 30 lines) are bundler entries; fold them into one `webview.ts` per module (V4, V5, V6, V16 to V21) only if the build config can point at it. Check `esbuild`/webview build config before merging. |
| Barrels stay at module root | One `index.ts` per module exposing only the Public API column; sub-features inside a module are plain files. |

#### Code in VS Code that probably belongs in core

Facts: of 1273 top-level units, 384 (2085 of 11321 lines) have no `vscode`/`dom`/`webview` effect in `effects_transitive`; 195 of them are exported (1019 lines). 39 files are made only of such units (569 lines); 14 hold three or more. The count is low: VS Code is mostly real glue, so the finding is small, not a mass migration.

| Candidate (unit or file) | Evidence | Move to |
|---|---|---|
| `writing/preview/staleSources.ts` (8 units, 41 lines), `readPdfProblems.ts` (6, 42), `buildRootBuilds.ts` (7, 29), `limits/checkCounts.ts` (3), `limits/buildRootWords.ts`, `synctex/projectSynctex.ts` (4, 31), `buildRootDocument.ts` (4) | no platform effect; the same preview needs exist in `browser/writing/preview` (`previewBuilds`, `buildScheduler`) | core `writing/preview` (one build-root facts module) |
| `libraryUi/sidebarMessages.ts` (`parseSidebarMessage`, 110 lines), `libraryUi/spaces/messages.ts` (`isSidebarSpaceMessage`) | pure parsers of the sidebar message protocol; the browser mounts the same sidebar | core `libraryUi` (protocol) |
| `libraryUi/host/listHandlers.ts` (140 lines) vs `browser/libraryUi/host/handlers/paperHandlers.ts` | clone family 14 (T1, reliable, 4 members across both apps: `titleOf`, two handler arrows); homonyms `removePapers`, `setTags`, `setNote`, `sendDetails`, `addToSpace`, `pickPaper` exist in both | core `libraryUi` host handlers over a `LibraryUiHost` port; each app keeps only the transport |
| `library/paperService.ts` + `paperFileService.ts` (13 exported pure units, 86 lines; `refreshMetadataFromPdf`) | pure over ports | core `library` |
| `collab/comments/sourceRanges.ts` (7 units, 49 lines, all pure) | clone family 51 (`lineAt`, 3 members: vscode `createProjectPreprints`, browser `commentThreads`, `projectShareEntry`) | core `collab/comments` |
| `collab/node/session/activeShares.ts` (`ActiveShares.hold`) vs `browser/collab/pageShares.ts` (`PageShareRegistry.hold`, `.entry`, `.onChange`) | clone families 201 (inline), 136, 103, 9; the same registry of open shares in both apps | core `collab/session` (registry), apps add only the disposal hook |
| `relay/relayProgress.ts` (`createLazyProgress`) vs `browser/reader/previewStartup.ts` (`attachPreviewPage`) | clone family 200 (inline, 23 nodes) | core `relay` (progress helper) |
| `writing/buildRootDocument.ts` (`isInside`), `library/node/offerLibraryMove.ts` | clone family 47: `isInside` in 3 files (2 vscode, 1 core `latex/build/node/findProblems.ts`) | one core path helper |
| `writing/search/writeReplacementsInProject.ts` (`buildEdit`), `writing/preview/citations/updateBibEntry.ts` (`publishedFixOf`), `addBibliographyToLibrary.ts` (`field`), `buildRootWords.ts`/`latexProjectSources.ts` (`reader.read`) | clone families 72, 79, 46, 113 duplicate code that already exists in core (`sectionBuildStateFile`, `versionFile`, `preprintIds`, `readChecklistSignals`) | delete the copy and call the core function |
| `reader/readerShell.ts` (`buildBootParams` 27, `readerDocument` 25 lines) | pure HTML/boot params; webview shell | keep in app unless the browser reader page shares it (not shown by clones) |

Cross-app: `homonyms` with packages exactly `browser,vscode`: 34 names (14 exported), 32 `different` and 2 `identical` (`lineAt`, `titleOf`). The different ones are parallel implementations of one concept, not copies: dialogs (`confirmReplace`, `confirmDisconnect`, `askProjectTitle`, `chooseAccount`, `showNotice`) legitimately differ per host, but their flows (`openProject`, `signInToGitHub`, `reportRelayFailure`, `copyIntoProject`, `createPreviewPorts`, `updateBibliography`) are orchestration that should be written once in core over a prompt port. Clone families spanning both apps: 4 (11 members); spanning an app and core: 16 (browser) and 5 (vscode), all small (15 to 41 nodes).

### 2.3 Browser modules

Source: same tables, scope `browser` (55 level-0 communities, 52 NULL = barrels). Runtime follows the extension surfaces: `background/` = worker, `content/` = content-script, everything else = dom. Entry surfaces stay as thin bootstraps (the architecture doc names one bootstrap per page); features move out of the pages.

| # | Module (`src/…`) | Purpose | Current dirs in (files / lines) | Communities | Runtime | Target files | Public API |
|---|---|---|---|---|---|---|---|
| B1 | `background/` | Service worker: message handlers, import offers, draft cache, copy request. | `background` 4 / 234, `handlers` 4 / 362, `import` 6 / 351, `copyRequest` 1 / 64 | 3 (part), 13, 6 (part) | worker | 5 | worker entry (composition root of the worker) |
| B2 | `content/` | Content script: page identifier extraction and search-page detection. | `content` 5 / 495 | 21, 22 | content-script | 3 | content entry; `isSearchPageUrl`, `extractIdentifiersFromHit` |
| B3 | `capture/` | Capture a page as a paper: page probe, PDF finding, tab fetch, access watches; the import helpers used by popup and worker. | `capture` 10 / 569, `capture/tab` 3 / 173, `import` 5 / 118 | 3 (part), 19, 20, 23, 29, 30 | dom | 5 | `attachPdfToPaper`, `derivePdfMiss`, `CaptureDraft`, `findPdf`, `readFirstPageText`, `loadPdfjs` |
| B4 | `popup/` | Popup page: capture flow, render, offer card. | `popup` 6 / 483 | 4 | dom | 4 | popup bootstrap |
| B5 | `options/` | Options page: sections for account, share, reader, helper, library folder. | `options` 12 / 682 | 6 (part), 49, 51 | dom | 5 | options bootstrap |
| B6 | `libraryUi/` | The library page UI: editor area (tabs, workspace), host message handlers, snapshots, sidebar, details, prefs, paper link, plus the library and reader page entries. | `libraryUi` 44 / 2301 (`editorArea` 17, `host` 14, `sidebar` 3, `details` 5, `prefs` 3, `paperLink` 3), `libraryPage` 2 / 288, `reader` 6 / 413, `spaces` 3 / 175 | 0, 2 (part), 12, 24, 26, 33, 31 (part), 32 | dom | 17 | `Workspace`, `parseTab`, `TabKindName`, `ProjectServices`, `openReader`, `createReaderUrl`, `PageSpaces`, `createPageSpaces`, `addToSpace` |
| B7 | `writing/` | Writing in the extension: editor, source updates and actions, session, project list, history, preview, plus latex/typst language support. | `writing` 39 / 2152 (`editor` 7, `source` 10, `session` 4, `preview` 6, `history` 5, `project` 5, `projectList` 2), `latex` 4 / 189, `typst` 4 / 194, `templates` 1 / 112 | 17 (part), 25, 27, 28, 31, 32, 35, 36, 37, 39, 40, 41, 42, 43, 44 | dom | 12 | `ProjectSession`, `showInOpenEditor`, `createBrowserProjectContent`, `findProject`, `createLatexSupport`, `createTypstSupport`, `createBrowserPublish` |
| B8 | `storage/` | IndexedDB adapters, the bridge, library location, picked directories and the shared-library storage. | `storage` 31 / 1942 (root 15, `bridge` 5, `collab` 4, `libraryLocation` 3, `pickedDir` 4), `library` 7 / 306 | 2, 8, 9, 10, 11, 14, 15, 16, 7 | dom | 12 | `listCachedPaperRecords`, `LibraryMutations`, `createLibraryFileSystem`, `LibraryLocation`, `refreshLibraryLocation`, `pickLibraryFolder` |
| B9 | `collab/` | Page shares, comments, mirror, stored keys. | `collab` 15 / 1465 (`comments` 3, `mirror` 3), `share` 1 / 28 | 17 (part), 18, 34, 16 | dom | 6 | `PageShare`, `CommentThreads`, `writeMemberName`, `reportPageWrites`, `createBrowserShareRegistryStore` |
| B10 | `helper/` | LaTeX Helper client: connection, project, setup card. | `helper` 16 / 1185 | 5, 35, 38, 45 | dom | 6 | `createBrowserLatexHelper`, `mountHelperSetupCard`, `createHelperSetupSection`, `createHelperProject` |
| B11 | `relay/` | Relay account store and page relay. | `relay` 6 / 399 | 46, 47, 48 | dom | 3 | `openBrowserRelayAccountStore`, `PageRelay`, `createPageRelay`, `updateOwnRelayOnStart` |
| B12 | `platform/` | `chrome.*` wrappers, messages, settings, logging, theme and the shared UI helpers. | `platform` 13 / 492, `ui` 3 / 81, `types` 2 / 21 | 1, 6 (part) | dom + worker | 5 | `bx`, `readSettings`, `createBrowserLogger`, `sendRuntime`, `applyTheme`, `readThemePref` |

Totals: 252 non-barrel files / 15.0k lines become about 85 files (median about 170 lines). `platform` has the highest cross-domain fan-in (138 imports from 18 other domains), so it stays a leaf with no imports from features. The `ui/` and `types/` folders of the browser merge into B12; the single file `templates/` and `share/` fold into the module that uses them.

#### Code in the browser that probably belongs in core

Facts: of 892 top-level units, 492 (3562 of 9400 lines) have no `browser-ext`/`dom`/`vscode` effect; 246 are exported (2163 lines). 85 files consist only of such units (2274 lines), 37 with three or more. Many of these are IndexedDB or `localStorage` wrappers, so the effect filter overestimates; the list below keeps only logic.

| Candidate | Evidence | Move to |
|---|---|---|
| `helper/project/createHelperProject.ts` (15 units, 141 lines), `helper/client/connection/helperConnection.ts` (10, 77), `helper/client/project/updateTracker.ts` (6) | no platform effect; the terminal builds the same Helper entry | core `helper` |
| `storage/bridge/bridgeConnection.ts` (24 units, 108 lines), `bridgeFileSystem.ts` (10), `connectBridge.ts` | bridge client logic, with `core/bridge` already holding the host side; clone 119 (`tabLease.ts` vs core `bridge/node/runBridgeHost.ts`) | core `bridge` |
| `storage/libraryLocation/moveToFolder.ts` (13, 102), `copyVerified.ts` (`sameBytes`, clone 43 of core `libraryMirrorFileSystem`) | library move logic over ports | core `library` (location and move) |
| `writing/session/openProjectSnapshot.ts` (`filesNodes`) vs core `writing/project/folder/projectFolder.ts` (`listBuildRootFileNames`) | clone 78 | delete the copy, call core |
| `writing/preview/pdfAssembly.ts` (`mergePdfPages`, `singlePage`) vs core `helper/node/comparePages.ts` | clone 162 | one core page-merge helper |
| `writing/preview/buildScheduler.ts`, `previewBuilds.ts`, `latex/createLatexSupport.ts` (9 units), `latex/projectLabels.ts` (`createProjectLabels`), `typst/*` | no platform effect; `createProjectLabels` is clone 116 of core `checkBibliography.ts` | core `writing` / `latex` / `typst` |
| `libraryUi/editorArea/tabKinds.ts` (24 units, 35 lines), `workspaceHash.ts`, `libraryUi/prefs/localStoragePrefs.ts` | tab model and prefs logic, same needs in the vscode webview prefs | core `libraryUi` |
| `libraryUi/sidebar/sidebarTree.ts` (`headButton`) vs core `reader/dom/preview/footer/citationProblems.ts` | clone 20 | core `ui`/`reader` shared piece |
| `capture/pageProbe.ts` (two `add`, clones 70 and 71 of core `import/landing/pageFacts.ts` and `htmlPage.ts`), `libraryUi/host/handlers/addFromTabHandler.ts` (`hostOf`, clone 35) | same page-fact extraction written twice | core `import/landing` |
| `capture/tab/tabFetch.ts` (`toBase64`) vs core `templates/host/thumbnailUri.ts` | clone 85 | core `encoding` |
| `collab/pageShares.ts` (`PageShareRegistry`), `collab/storedShareKeys.ts` (`isObject`, clone 7 of core `shareManifest.ts`), `collab/comments/commentThreads.ts` (`onChange`, `lineAt`) | clones 7, 9, 103, 136, 152, 201, 51 | core `collab` registry and comment-thread model |
| `reader/previewStartup.ts` (`attachPreviewPage`) | clone 200 with vscode `relayProgress.ts` | core `relay` |

Browser to core clone families: 16 (39 members), of which 11 are `inline` and `warning` precision; the ones above are the largest by node count (15 to 41).


## 3. Duplicates

Source: `clone_families` (T1 18, T2 1 reliable; near 10, inline 171, name-variant 23) plus `homonyms`. Merging means one canonical copy per row and rewriting every caller; no file moves are needed for this section. Caller counts come from `calls.callee_id` (resolved calls inside the repo); "sites" are examples. Paths are relative to `packages/<pkg>/src/`.

Rule used for the target module: a helper that is neutral (no `node:*`, no DOM) goes to a neutral core module; a helper that needs `node:fs` goes to `core/files/node`; DOM helpers go to `core/dom` (or the existing `core/ui/dom`); anything that touches `vscode.*` stays in the vscode package.

### 3.1 Summary of decisions

Names of the shared modules are the ones fixed in section 4 and drawn in 5.1: `core/guards` (predicates over `unknown`, canonical plain-object guard is `isRecord`), `core/json` (text to object parsing only: `parseJsonObject`), `core/path` (`isInside`), `core/url` (`hostOf`), `core/events` (`createListeners`), `core/files/node` (`fsProbe`), `core/encoding` (`sameBytes`, `randomHex`).

| # | Subject | Families | Copies | Canonical home | Behaviour differs? | Section |
|---|---|---|---|---|---|---|
| A | Plain-object guard (`isRecord`, `isObject`, `isObj`, `isJsonObject`, `isPlainObject`, `isBody`, `isCatalogJsonObject`) | T1 #2 #4 #6 #7 #10, near/nv #36 #38 #39 | 17 units, 74 calls | `core/guards` (new) `isRecord` | yes: 2 copies accept arrays | 3.2 |
| B | Field guards (`isText`, `isNum`, `isStr`, `isBool`, `isOneOf`, `isTimestamp`) | nv #31 #32 #33 #34 #44 #45 | about 30 units | `core/guards` primitives, split by meaning | yes: 4 meanings of `isText` | 3.3 |
| C | Path containment (`isInside`, `isWithin`, inline `relative`/`startsWith("..")`) | nv #47 + 9 inline sites | 3 named + 9 inline | `core/path` `isInside(paths, folder, file, {allowEqual})` | yes: equal path, `..` prefix, isAbsolute | 3.4 |
| D | Host of a URL (`hostOf`) | T-none, nv #35 | 4 | `core/url` `hostOf` | yes: 3 variants | 3.5 |
| E | Listener registry (`onChange`) | T1 #1 #9, inline #103 | 4 methods + 9 inline pairs | `core/events` `createListeners()` | no (one returns boolean) | 3.6 |
| F | File probes (`isDirectory`, `isDir`, `isFile`, `exists`) | T1 #11 #12 #13 | 3 + 2 + 3 | `core/files/node/fsProbe` (node), vscode `pathExists` | no | 3.7 |
| G | Mirror read with settle (`readDisk`, `read`, `sampleBytes`) | T2 #19, nv #43 | 2 + 2 | `core/collab/mirror` `readStable(sample, ms)`, `sameBytes` in `core/encoding` | no / yes for `sameBytes` | 3.8 |
| H | Small exact or near-exact copies | T1 #3 #5 #8 #14 #15 #16 #17 #18 | see table | various | no | 3.9 |
| I | Near and name-variant families | #20-#29, #30 #37 #40-#42 #46 #48-#52 | 33 families | per row | mostly no | 3.10 |
| J | Inline families | 171 | see triage | per row | n/a | 3.11 |

Rejected warning-tier material and non-duplicates are listed in 3.12.

### 3.2 A. Plain-object guard

Seventeen units across 13 core files and one browser file test "non-null object that is not an array" (or a subset of it). Every `parseXMessage` file defines its own because core has no shared JSON module. The nearest existing one is `spaces/model/json/fieldChecks.ts:2 isJsonObject` (exported, 26 calls through three same-name units); it sits inside the spaces domain, so other domains cannot depend on it.

| Copy | Location | Returns | Callers |
|---|---|---|---|
| `isJsonObject` (canonical candidate) | core `spaces/model/json/fieldChecks.ts:2` | rejects null, arrays | via barrel: `readEntries`, `parseSpaceFile`, `glossaryFile`, `parseSpaceDrafts`, `parseSpacesMessage` |
| `isJsonObject` | core `collab/comments/commentThread.ts:30`, browser `collab/storedShareKeys.ts:8` | same | 6 + 7 (`commentsFile`, `updateUnscopedShares`) |
| `isCatalogJsonObject` | core `templates/templateManifest/catalogJson.ts:3` | same | 6 (`catalogIndex`, `universeCatalogIndex`) |
| `isBody` | core `helper/messageFields.ts:15` | same, typed `Body` | 6 (`readToHelper`, `readToPage`, `fields`) |
| `isPlainObject` | core `library/sharedConfig.ts:18` | same | 3 |
| `isObject` x3 | core `import/citationMap/createCitationCache.ts:81`, `share/shareManifest.ts:34`, `libraryUi/share/shareMessages.ts:55` | same, but two are typed to a local `Json`/`Raw` alias | 2 + 6 + 4 |
| `isObj` x3 | core `reader/previewRequests.ts:60`, `reader/protocol/webviewGuard.ts:11`, `reader/previewProtocol.ts:144` | same | 2 + 3 + 3 |
| `isRecord` x3 | core `templates/protocol/messageGuards.ts:16`, `writing/search/protocol/parseSearchMessage.ts:7`, `writing/checklist/checklistFile.ts:45` | same | 3 + 2 + 0 |
| `isRecord` x2 (loose) | core `relay/client/cloudflareClient.ts:47`, `relay/client/accounts.ts:36` | **accepts arrays** | 5 + 2 |

Decision needed: the two loose `isRecord` copies in `relay/client` return true for arrays. Their callers read `parsed.errors`, `first.code`, `parsed.success`, which are undefined on an array, so the result is the same in practice. Recommend switching them to the strict guard and adding one test (`[]` is rejected). Typed variants (`value is Raw`, `Fields`, `Body`) become `isRecord(value)` followed by a local cast, or a generic `isRecord<T extends object = Record<string, unknown>>`.

Also note: `spaces/model/json/fieldChecks.ts` already defines `isString`, `isNonEmptyString`, `isBoolean`, `isPage`, `isNonEmptyStringList` that duplicate the primitives in 3.3; move the whole file's neutral part to `core/guards`, keep `isDay` with the spaces domain.

### 3.3 B. Field guards (same name, different meaning)

`isText` has ten units in ten files but four meanings; merging by name would change validation.

| Meaning | Copies (core) | Canonical |
|---|---|---|
| non-blank string (`trim() !== ""`) | `writing/project/userSettings.ts:36`, `writing/project/listedPapers.ts:13`, `writing/allProjects/protocol/parseAllProjectsMessage.ts:6`, `spaces/protocol/parseSpaceDrafts.ts:5`, `spaces/protocol/parseSpacesMessage.ts:9` (nv #31 #33, 12 calls) | `core/guards` `isNonBlankString` |
| non-empty string (`!== ""`) | `collab/comments/commentThread.ts:34`, `spaces/model/json/fieldChecks.ts:7 isNonEmptyString` | `core/guards` `isNonEmptyString` |
| any string | `libraryUi/protocol/messageGuards.ts:9`, `writing/search/protocol/parseSearchMessage.ts:8`; also `isStr`/`isString` x6 (`reader/*`, `share/shareManifest.ts:35`, `collab/deviceState/collabStore.ts:126`, `fieldChecks.ts:6`) | `core/guards` `isString` |
| string with length cap | `templates/protocol/messageGuards.ts:25` (20 000), `libraryUi/share/shareMessages.ts:60` (16 384) | `isStringUpTo(max)` factory; the two limits stay local constants |

Decision needed: whether the five "non-blank" copies truly want to reject whitespace-only strings (they do today; keep). Same exercise for `isNum` (3 identical copies in `reader/*`, finite number, 12 calls), `isBool` (3, identical), `isOneOf` (`writing/project/projectFile.ts:67` ≡ `templates/templateManifest/templateManifest.ts:38`, typed predicate; `reader/previewRequests.ts:61` takes `(list, v)` untyped), `isTimestamp` (`collab/comments/commentThread.ts:35` ≡ `writing/checklist/checklistFile.ts:41`: `Date.parse` not NaN). Also `isCallId`/`isLine` (T1 #8): integer >= 0 predicates in `libraryUi/share/shareMessages.ts:56` and `libraryUi/protocol/messageGuards.ts:16`; canonical `isCount` in `core/guards`.

### 3.4 C. Path containment

Canonical: `core/path` `isInside(paths: PathOps, folder, file, options?)`. The existing exported copy is `vscode writing/buildRootDocument.ts:12 isInside(paths, folder, file)` (7 callers: `readActiveProjectEditor:12`, `staleSources:68`, `buildRootDocument:21`, `citationSectionsCache:56`, `registerInsertActions:54`, `projectSearchFiles:48`, `openProjectSignals:99`). Core cannot import from vscode, so it moves down to core, neutral through `PathOps`; node callers pass `nodePathOps` (confirm the name when implementing).

The test is "relative path, not starting with `..`, not absolute". Four policy choices appear:

| Variant | Equal path counts as inside? | Sites |
|---|---|---|
| strict (relative must be non-empty) | no | core `latex/build/node/findProblems.ts:15`; vscode `writing/buildRootDocument.ts:12`; core `writing/allProjects/library/projectHostActions.ts:40` (throws); vscode `collab/comments/commentsController.ts:216` (`!relative`), `collab/node/editors/sharedEditors.ts:19` (`relative &&`) |
| inclusive | yes | vscode `library/node/offerLibraryMove.ts:19` (child, parent order); core `latex/biber/node/runBiber.ts:38 isWithin`, `library/conflicts/node/project/projectConflictResolution.ts:67`; core `writing/project/buildRoot/buildRootOf.ts:21` (equal falls through to the extension test and returns `main`); vscode `writing/typst/node/typstBuilds.ts:36` |
| escape test only (returns the other branch) | n/a | core `library/node/libraryLocation/formatPath.ts:7` (equal handled first, returns `~`), vscode `writing/buildRootDocument.ts:35 deriveProjectPath` |

Findings to decide before merging:
- `typstBuilds.ts:36` omits `isAbsolute`. On POSIX `path.relative` never returns an absolute path, so there is no bug; on Windows a file on another drive returns an absolute path, passes the test, and its unsaved text is sent into the Typst build. Fix by using the shared function (it adds `isAbsolute`).
- All copies use `startsWith("..")`, which also treats a child named `..notes` as outside. Recommend `relative === ".." || relative.startsWith(".." + sep)` in the canonical version; add one test. Decision needed because it changes behaviour for such names (none known in the repo).
- `offerLibraryMove.ts:19` has swapped argument order (child, parent) and inclusive semantics; callers `offerLibraryMove.ts:38` (1 call) pass `(root, folder.path)`. Convert to `isInside(paths, folder, root, {allowEqual: true})` carefully: the argument order flips.
- Provide `{ allowEqual }` (default false) and keep the inclusive sites on `allowEqual: true`; do not silently unify them.

Callers to update: 3 named (9 call sites) + 9 inline copies (1 site each, listed above).

### 3.5 D. `hostOf`

| Copy | Returns | Callers | Used for |
|---|---|---|---|
| core `import/landing/pageFacts.ts:49` ≡ browser `libraryUi/host/handlers/addFromTabHandler.ts:8` | `new URL(u).hostname`, `""` on failure | 2 + 1 | display host |
| core `import/pdfFinder/client/signatures.ts:46` | same, lower-cased | 1 | cache signature |
| core `import/pdfFinder/engine/hostPacer.ts:34` | `.host` (includes port), accepts `Request`/`URL`, returns the **input** on failure | 1 | per-host throttling key |

Canonical: `core/url` `hostOf(url): string` (hostname, `""` on failure). `URL.hostname` is already lower-case, so the `toLowerCase()` in `signatures.ts` is redundant and that copy merges with no change. `hostPacer` keeps `.host` and the input fallback on purpose (port matters for pacing); either keep it local under a different purpose or add `hostKeyOf`. Decision: keep `hostPacer` separate.

### 3.6 E. Listener registry (`onChange`)

Four methods have the body `this.listeners.add(l); return () => this.listeners.delete(l)` (T1 #1: `library/model/libraryStore.ts:91`, `spaces/store/spaceStore.ts:109`; T1 #9: `collab/relays/relaySelector.ts:75`, browser `collab/pageShares.ts:124`), and inline family #103 has nine more two-statement copies in eight files (`collab/relays/relayWatch.ts:99`, `collab/session/storageHealth.ts:38`, `collab/session/shareConnection.ts:149` and `:184`, browser `collab/mirror/localFileChanges.ts:15`, `writing/project/browserProjectLibrary.ts:78`, `writing/preview/previewFrame.ts:59`, browser `spaces/pageSpa*` (name cut off in the query)).

| Aspect | Value |
|---|---|
| Canonical | `core/events` `createListeners<T>()` returning `{ add(l): () => void, emit(v), clear() }` |
| Difference | libraryStore/spaceStore return `Set.delete`'s boolean, the others return `undefined`; the declared type is `() => void` in all, so callers cannot depend on it |
| Callers to update | the 4 classes keep `onChange` as a one-line delegate (their own callers, 0 to 3 each, are unaffected); the 9 inline sites switch to the helper |
| Decision | none; do not touch the listener `Set` iteration code that differs (error isolation while emitting is not uniform; check each emitter when adopting `emit`) |

### 3.7 F. File probes

| Probe | Copies | Canonical |
|---|---|---|
| directory exists | core `library/node/libraryLocation/detectSyncFolders.ts:110 isDirectory` (1 caller), `library/node/libraryLocation/detectLibraryFolder.ts:14 isDirectory` (1), `nativeHost/node/layout/browserDetection.ts:43 isDir` (3) | `core/files/node/fsProbe` `isDirectory(path)` |
| regular file exists | core `latex/build/node/findProblems.ts:20 isFile` (1), `typst/node/typstFonts.ts:23 exists` (1) | `core/files/node/fsProbe` `isFile(path)` |
| uri exists (vscode) | `ui/hasBundleFile.ts:4` (9 callers), `writing/registerInsertActions.ts:27` (1), `writing/tree/projectFileCommands.ts:37` (1) | one vscode `pathExists(uri)` beside `hasBundleFile`; rename is not part of this section |

No behaviour difference: all swallow the error and return `false`. Note that `vscode ... exists` is `stat` success (file or folder), while `core exists` in `typstFonts` means file; keep the two names/meanings apart (`isFile` vs `pathExists`). Place it in `files/node/` and export it from the `@labshelf/core/node` entry, like the other node modules.

### 3.8 G. Mirror read and byte comparison

| Item | Copies | Canonical | Difference |
|---|---|---|---|
| read with settle (T2 #19, 65 nodes) | core `collab/mirror/fileSystem/libraryMirrorFileSystem.ts:34 read` (path relative to the folder, 0 direct callers because used through the port), `collab/node/nodeMirrorFileSystem.ts:30 readDisk` (1 caller) | `core/collab/mirror` `readStable(sample, settleMs)`; each file keeps only its own `sample` | only the `sample` function differs (port `fs.stat` vs `node:fs`); logic is identical, including the `changing` state |
| `sameBytes` (nv #43, 0.74) | core `collab/mirror/fileSystem/libraryMirrorFileSystem.ts:9` (1 caller), browser `storage/libraryLocation/copyVerified.ts:6` (2) | `core/encoding` `sameBytes(a, b)` | not read in full; shapes differ by 2 nodes. Decision: check the browser copy's early length check before merging, as it may handle `ArrayBuffer` vs `Uint8Array` differently |

### 3.9 H. Small exact copies

| Family | Copies | Canonical | Callers | Notes |
|---|---|---|---|---|
| T1 #3 `randomSuffix` | core `writing/versions/addProjectVersion.ts:9`, `writing/project/mutation/createProjectFromTemplate.ts:29` | `core/encoding` `randomHex(bytes = 4)` | 1 + 1 | 4 random bytes as lower-case hex via `crypto.getRandomValues`, identical |
| T1 #5 path comparator | `templates/sources/universeSource.ts:36`, `templates/fileSystem/mineSource.ts:34`, `templates/node/walkFolder.ts:37` | `core/templates` `comparePaths(a, b)` (code-unit compare, not `localeCompare`) | 0 (inline arrow in `.sort`) | order must stay code-unit; do not replace with `localeCompare` |
| T1 #14 `titleOf` | vscode `libraryUi/host/listHandlers.ts:37` and `:50`, browser `libraryUi/host/handlers/paperHandlers.ts:34` and `:43` | `core/libraryUi` `titleResolver(papers)` | 0 | `papers.find(p => p.id === id)?.title ?? id`, four closures in two files; the same builder serves both hosts |
| T1 #15 / #16 / #29 `dispose` | vscode `ProjectFiguresView:63`, `ChecklistView:278`, `ProjectSession:89`, `ProjectFilesProvider:71`, `AllProjectsPanel:92`, `GalleryPanel:93` | vscode `disposables/disposeAll(list)` plus a `PanelBase` for the last two | 2 calls each | panels also guard re-entry through `onDidDispose`; the other four are `subscriptions.forEach(dispose); emitter.dispose()`, also in 3 more files (inline #171, #182) |
| T1 #17 session logger | vscode `writing/build/node/createSessionLogger.ts:7` (3 callers), `writing/typst/registerTypstLanguage.ts:154 hostLogger` (1) | the exported `createSessionLogger` | delete `hostLogger` and import | identical bodies, 51 nodes |
| T1 #18 webview channel | vscode `libraryUi/webview/libraryUiChannel.ts:7`, `writing/allProjects/webview/allProjectsEntry.ts:27` | `createWebviewChannel<Ui, Host>()` in the shared vscode webview module | 0 | differ only in the two message type arguments; make the function generic |
| T1 #8 `isCallId`/`isLine` | see 3.3 | `isCount` | 4 | merge inside A/B |

### 3.10 I. Near and name-variant families

| Family | Verdict | Canonical home | Note |
|---|---|---|---|
| near #20 `arrow` vs `headButton` (core `reader/dom/preview/footer/citationProblems.ts:19`, browser `libraryUi/sidebar/sidebarTree.ts:16`) | confirm | `core/ui/dom` button builder | 41 nodes, sim 0.8; same element builder with different class names; read before merging |
| near #21 `deleteFile`/`removeTree` (vscode `storage/vscodeFileSystem.ts:86,100`) | one file, keep | none | same file, two modes; fold the shared stat+delete prologue locally only |
| near #22 `latexProjectOf`/`typstProjectOf` (vscode `writing/build/latexWriteBuilds.ts:24`, `writing/typst/typstTriggers.ts:25`) | merge | vscode `writing/projectOfDocument` | differ by the engine filter; parametrize on engine (1 + 2 callers) |
| near #23 `validProxies`/`validResolvers`, #24 `listWritable*`, #25 anonymous renderers (browser `platform/settings.ts:51,62`, `options/proxySection.ts`, `options/resolverSection.ts`) | merge | browser `options/list` generic over a record kind | three families describe one pattern in two settings sections; decision: generic config list helper, 1 caller each |
| near #26 `changedSide`/`mergeValue` (core `qmd/conflict/mergeItemFiles.ts:19,121`) | keep | none | same file, different roles that share a switch shape |
| nv #27 `stringEnd` (core `typst/language/syntax/typstWalk.ts:38`, `scanTypstFile.ts:39`) | confirm | `core/typst/language/syntax` | sim 0.83, 47 vs 51 nodes; 1 + 2 callers; compare escape handling before choosing |
| near #28 two anonymous (browser `writing/history/historyHost.ts:97`, `writing/mountSearchHost.ts:153`) | merge | browser `writing` host-attach helper | 50 nodes each, identical shape; 0 direct callers |
| nv #30 `pick` (core `import/pdf/xmp.ts:21` 15 callers, `import/pdf/pdfDictionary.ts:31` 9) | keep | none | first-match across different inputs (XMP tags vs dictionary entries); sim 0.78 only because of shape; do not merge |
| nv #32/#37/#38 `accepts`, `isRecord` | see A and B; `accepts` (core `libraryUi/dom/drag/paperDrag.ts:8`, `libraryUi/dom/sidebar/spaces/renderSpaceRows.ts:10`, identical, 2 + 2 callers) | `core/libraryUi/dom/drag` `acceptsPaperDrop` | |
| nv #40 `open` (browser `storage/pickedDir/pickedDirStore.ts:24`, `storage/pdfStaging.ts:22`) | merge | browser `storage/openDatabase(name, version, stores)` | IndexedDB open; 5 + 4 callers; sim 0.71 caused by different store names/versions |
| nv #41 `pad` (core `libraryUi/viewModel/projectRowItem.ts:34`, `spaces/viewModel/formatLocalDay.ts:4`) | merge | `core/format` `padTwo` | identical, 2 + 2 callers; both also repeat local-day formatting (`formatLocalDay`) |
| nv #42 `encode` (core `collab/comments/commentAnchor.ts:21`, `collab/binding/relativeSelection.ts:10`) | confirm | `core/collab/binding` | base64 of a Yjs relative position; two nodes apart; check padding rule |
| nv #44 `isTimestamp`, #45 `isNum`, #31-#34 | see 3.3 | | |
| nv #46 `field` (core `writing/bibliography/preprintIds.ts:19`, vscode `writing/preview/citations/addBibliographyToLibrary.ts:29`) | merge | `core/writing/bibliography` | identical 11 nodes; 3 + 3 callers; the vscode package already imports from core |
| nv #48 `message` (core `spaces/store/readSpace.ts:6`, `spaces/store/spaceStore.ts:18`) | merge | `core/spaces/store` | identical `error instanceof Error ? error.message : String(error)`; 2 + 4 callers. Same expression appears at least once more in inline #114 |
| nv #49 `schedule` (vscode `writing/figures/figureWatchers.ts:27`, `writing/tree/projectFilesWatcher.ts:15`) | merge | vscode `watchers/debounced` | debounce timer; sim 0.67 from different delay constants |
| nv #50 `method` (6 files in core `typst/language/typstStdlib/`) | keep | none | table builders, identical but 12 nodes each; one per file by design (data tables) |
| nv #51 `lineAt` / #52 `newComment` (vscode `writing/preview/buildRoot/createProjectPreprints.ts:15`; browser `collab/comments/commentThreads.ts:38,99`, `collab/projectShareEntry.ts:27,39`) | merge | browser `collab/comments` | `lineAt` identical in 3 files; `newComment` 23 vs 24 nodes, read the one-node difference |
| nv #47 `isInside` | see 3.4 | | |

### 3.11 J. Inline families (171)

SQL triage: 171 families; 127 cross-file, 44 single-file (rejected: one-file repetition is a local extract, not a cross-module merge); 16 span two packages; 144 are 2-statement windows, 27 are 3-statement; 115 have `nodes_max` < 25. Ranked by `nodes_min * members`, the top 40 were listed and about 32 were read (first member only). Result:

| Group | Families | Merge into | Verdict |
|---|---|---|---|
| Listener registry | #103 | `core/events` (3.6) | merge, 9 sites |
| JSON parse then object check | #95 #96 (core `relay/account/relayAccount.ts:26`, `library/writeRecords/writeRecords.ts:22`, `collab/mirror/leaseFile.ts:27`, `writing/project/deviceLocal/parseJsonObject.ts:5`) | `core/json` `parseJsonObject(text): Record \| undefined` | merge, 4 sites; `parseJsonObject.ts` is already that function and is the natural canonical |
| Bytes to binary string, chunked | #85 (core `templates/host/thumbnailUri.ts:11`, browser `capture/tab/tabFetch.ts:51`) | `core/encoding` `bytesToBinary` | merge; the 0x8000 chunk limit is the shared trap |
| Webview HTML skeleton (nonce + CSP) | #167 (5 vscode panels: `registerSyncGuideCommand`, `allProjectsPanel`, `searchHtml`, `researchChatView`, `historyPanel`), #165 | vscode `webview/htmlShell` | merge; decision: allowed `style-src`/`font-src` differ per panel, pass as options |
| Subscription dispose | #171 #182 | vscode `disposeAll` (3.9) | merge, 7 sites |
| Active project of editor | #175 #178 #183 #176 #186 #188 (vscode: `findOwningProject(activeEditor)` and `host.current()` guards) | vscode `writing/activeProject` | merge only the active-editor lookup (3 sites: `registerShowPreview:20`, `registerShowInPreview:21`, `compilerStatusBar:15`, `buildRootStatusBar:14`); `host.current()` guards stay |
| Reader area mark | #129 #130 (core `reader/dom/navigation/changeMarks.ts:43`, `reader/dom/preview/problemMarks.ts:62`) | `core/reader/dom` `renderAreaMark` | merge, 63 nodes: percent geometry of a PDF area |
| Dialog buttons / overlay | #153 #155 #121 (core `spaces/dom/spaceOverview/openDateDialog.ts:79`, `spaces/dom/glossary/mountSpaceGlossary.ts:72,74`, `spaces/dom/papers/picker.ts:24`, `ui/dom/widgets/overlay.ts:42`) | `core/ui/dom` dialog helper | merge Cancel/Save row and close-with-unsubscribe |
| Loopback transport + serve | #215 (browser `libraryUi/editorArea/spacesCatalogTab.ts:7`, `spacesPageTab.ts:8`), #114 | browser `editorArea/mountSpacesTab` | merge, 2 sites |
| Multiset overlap | #57 #58 (core `writing/text/deriveLineSimilarity.ts:11`, `import/paper/samePaper.ts:55`) | `core/text` `countCommon(left, right)` | merge; decide whether the Dice denominator stays in each caller (yes) |
| Visibility + message subscription | #213 (browser `spaces/watchSpaces.ts:12`, `libraryUi/host/snapshots/librarySnapshots.ts:86`) | browser `platform/watchVisibility` | merge, 2 sites |
| Line starts | #73 (core `latex/source/commands/scanContext.ts:10`, `latex/build/section/collectMacros.ts:79`) | `core/latex/source` `lineStartsOf` | merge; likely a third copy in `core/reader/text/textLines.ts` (not read) |
| Others read | #78 #77 #98 #113 #133 #204 #107 #60 #139 #198 | none | rejected as guard/destructuring/loop boilerplate with domain-specific tails |

The remaining ~130 families (not read) are: two-statement logger/guard/destructure boilerplate (about 115 with < 25 nodes), single-file repeats (44), and ordinary two-line `await x; if (!x) return` shapes. Rejected as noise by rule.

### 3.12 Rejected and not-done

| Item | Reason |
|---|---|
| `readJson` x3 (core `relay/client/cloudflareClient.ts:49`, `relay/oauth/tokenEndpoint.ts:51`, `relay/worker/answerRelayRequest.ts:54`) | different inputs (`Response`, `Response`, `Request`) and results (text on failure; `{}` on failure; `undefined` with a size cap); the shared `JSON.parse` try/catch is covered by `parseJsonObject` in 3.11, nothing else merges |
| homonyms `open`/`close`/`refuse`/`schedule`/`encode` (units 6 to 15 in `homonyms`) | `open` (15 units) similarity 0.71 is shape only; `close`, `refuse`, `method` identical-subset but 1 line, factory methods |
| near #31/#32/#33 `isText` at 0.85 to 1.0 | share the name but not the meaning; merge per 3.3, not by similarity |
| single-file near families #21 #26 | same-file repeats |

### 3.13 Not verified in this section

- Families #20, #27, #42, #43, #52 and the unread inline families were judged by name, node count and the first member only; read the second member before merging.
- Caller counts are resolved calls in `calls`; callers through destructured imports or passed as a callback (for example `.filter(isText)`) are not counted, so grep `import_names` before deleting a copy.

## 4. Helpers to promote

Source: private free helpers in `units` (exported = 0, function/arrow, owner IS NULL, top-level), filtered by `effects_transitive` and checked against exported homes in core. Counts below are units found by name and body check, not a full census; the exact-clone detail lives in the clone-families section. Core has no generic `util` folder: the shared pieces that already exist are `core/src/encoding/` (`base64`, `base64url`, `hex`, `joinBytes`), `core/src/hash/contentHash.ts` (`deriveSha256Hex`), `core/src/library/paper/{date,elapsed}.ts` (date formatting), `core/src/reader/navigation/debounce.ts`, `core/src/logging/logEntry.ts` (fan_in 125, carries an error-message helper) and `core/src/library/mutations/pathOps.ts` (`posixPathOps`, fan_in 23). Several of these sit in a domain folder that hides them from other domains, so part of the work is moving existing code to a neutral home, not only folding private copies.

### Summary

| Module | Runtime | Helpers absorbed | Files touched | Existing home |
|---|---|---|---|---|
| `core/guards` | neutral | 36 (isRecord 5, isObject 3 plus isJsonObject/isPlainObject/isCatalogJsonObject 4, isObj 3, isText 10, isString/isStr 4, isNum 3, isBool 3, isOneOf 3, isArray/isStringArray 2) | ~34 | `spaces/model/json/fieldChecks.ts` (fan_in 9) |
| `core/async` (debounce, sleep, abortable timers) | neutral | 25 inline debounce timers, 2 debouncers, 1 sleep | ~28 | `reader/navigation/debounce.ts` (fan_in 3), `vscode/src/latex/debounce.ts` |
| `core/time` | neutral (Intl, no DOM) | 11 (formatting 7, day validation 3, day arithmetic 1) | ~10 | `library/paper/date.ts`, `library/paper/elapsed.ts`, `spaces/viewModel/formatLocalDay.ts` |
| `core/path` (`PathOps` plus string path helpers) | neutral; `node/` variant for confinement | 14 (baseName 4, folderOf 2, extensionOf 2, stemOf/fileStem 2, directoryOf/directory 2, isInside 3 incl. 1 exported) | ~16 | `library/mutations/pathOps.ts` and `PathOps` in `mutationDeps.ts` (fan_in 79) |
| `core/errors` | neutral | ~8 (message 1, describeError 1, toError 1, asError 1, errorCode/errnoCode/errorCodeOf 3, isAbort 1) | ~8 plus inline copies | `logging/logEntry.ts` |
| `core/encoding` and `core/hash` (extend) | neutral | 11 (sha256Hex 1, deriveTextHash/deriveCodeHash/deriveMirrorHash 3, hexToBytes 1, toBase64 1, sameBytes 2, cryptoFill 2, decodeKey 2) | ~11 | `encoding/*`, `hash/contentHash.ts` |
| `core/url` | neutral | 7 (hostOf 4, originOf 1, normaliseOrigin 1, parseUrl 1) | ~8 | none (`import/pdfFinder/urlParts.ts` is import-specific) |
| `core/text/lines` | neutral | 5 (lineAt 3, lineEnd 2, lineStarts 1) | ~6 | `writing/text/lineOffsets.ts` (fan_in 4) |
| `core/json` | neutral | 4 (`parseJsonObject` inline copies: JSON parse then object check, 3.11) | 4 | `writing/project/deviceLocal/parseJsonObject.ts` |
| `core/events` | neutral | 13 (4 `onChange` methods, 9 inline pairs, 3.6) | ~12 | none |
| `core/files` (`node/`) | node | 8 (`isDirectory` 3, `isDir`, `isFile`, `exists`; `writeFileAtomic` moves here) | ~8 | `library/node/` (`writeFileAtomic`) |

### `core/guards`

- Purpose: one set of `unknown` narrowing predicates for message and file parsers, replacing per-file copies.
- Runtime: neutral. Existing home: `spaces/model/json/fieldChecks.ts` exports `isJsonObject`, `isString`, `isNonEmptyString`, `isBoolean`, `isOptional`, `isDay`, `isPage`, `isNonEmptyStringList`, but it is under `spaces/` and 9 files import it.
- Absorbs, with the same signature `(value: unknown): value is T`:
  - `isRecord` x5 (`templates/protocol/messageGuards.ts:16`, `relay/client/cloudflareClient.ts:47`, `relay/client/accounts.ts:36`, `writing/checklist/checklistFile.ts:45`, `writing/search/protocol/parseSearchMessage.ts:7`).
  - `isObject` x3 (`import/citationMap/createCitationCache.ts:81`, `share/shareManifest.ts:34`, `libraryUi/share/shareMessages.ts:55`), `isPlainObject` (`library/sharedConfig.ts:18`), and three exported twins `isJsonObject` (`collab/comments/commentThread.ts:30`, `spaces/model/json/fieldChecks.ts:2`) and `isCatalogJsonObject` (`templates/templateManifest/catalogJson.ts:3`); clone family 4 is a T1 match of `isCatalogJsonObject`, `isJsonObject` and `isRecord`, family 2 of `isPlainObject`, `isObject`, `isBody`.
  - `isObj` x3 (`reader/previewRequests.ts:60`, `reader/protocol/webviewGuard.ts:11`, `reader/previewProtocol.ts:144`; clone family 10), `isStr`/`isString` x4, `isNum` x3, `isBool` x3, `isArray`, `isStringArray`.
  - `isText` x10, all `(value: unknown): value is string` (for example `spaces/protocol/parseSpacesMessage.ts:9`, `writing/project/userSettings.ts:36`); the homonym verdict is "variant" because three return `boolean` instead of a predicate, which is a latent typing gap, not a real difference.
  - `isOneOf` x3 (`writing/project/projectFile.ts:67`, `templates/templateManifest/templateManifest.ts:38`, `reader/previewRequests.ts:61`).
- Public API: `isRecord(value): value is Record<string, unknown>`, `isString`, `isNonEmptyString`, `isNonBlankString`, `isStringUpTo(max)`, `isTimestamp`, `isNumber` (finite), `isBoolean`, `isStringArray`, `isOneOf<T extends string>(values: readonly T[], value: unknown): value is T`, `isOptional<T>(value, check)`. Keep `isDay`/`isPage` in `core/time` and `fieldChecks` as spaces-specific.
- Callers to update: about 34 files (the 9 importers of `fieldChecks` re-point to the new path).
- Judgment call: `isNum` in `reader/previewRequests.ts` may accept `NaN`; the shared `isNumber` should require `Number.isFinite` and the three copies must be compared before swapping.

### `core/async`

- Purpose: timers and scheduling that every host re-implements (trailing debounce, abortable sleep).
- Runtime: neutral (`setTimeout`/`AbortSignal` exist in all three runtimes). Existing homes: `createDebouncer` in `reader/navigation/debounce.ts` (trailing edge with `flush`, `cancel`, `pending`) and `createTrailingDebounce` in `vscode/src/latex/debounce.ts` (keyed, `dispose`).
- Absorbs:
  - 25 units across 24 files that call both `clearTimeout` and `setTimeout` in a body of at most 8 lines, all the same "clear the handle, set it again" debounce: `vscode/src/writing/tree/projectFilesWatcher.ts:15`, `vscode/src/writing/figures/figureWatchers.ts:27`, `vscode/src/writing/citations/projectBacklinks.ts:46`, `vscode/src/writing/search/projectSearchView.ts:112`, `vscode/src/storage/externalChangeWatcher.ts:29`, `vscode/src/libraryUi/libraryFeed.ts:132`, `browser/src/options/index.ts:27`, `browser/src/latex/projectLabels.ts:35`, `core/src/libraryUi/dom/header/listHeader.ts:59`, `core/src/writing/allProjects/dom/allProjectsHeader.ts:40`, and others. Of these, 12 are class methods named `schedule` or `scheduleX` (owner not null), so only about 13 are free helpers; the module still removes all 25.
  - `sleep` in `import/pdfFinder/engine/hostPacer.ts:43` (abortable); `createDeadline` in `import/pdfFinder/engine/createDeadline.ts` is already exported and fits here.
- Public API: `createDebouncer<A>(fn, ms): Debouncer<A>` (moved as is), `createKeyedDebouncer<K>(ms, run): { call(key: K): void; dispose(): void }` (the vscode one, generalised), `sleep(ms: number, signal?: AbortSignal): Promise<void>`, `createDeadline`.
- Callers to update: about 28 (24 debounce sites, the 2 existing importers set, hostPacer). Debouncers that hold a `vscode.Disposable` keep a one-line adapter in vscode.
- Note: `ExternalChangeWatcher.schedule` and `commentsController.scheduleRelocate` also skip work before arming; they use the debouncer inside, not a copy.

### `core/time`

- Purpose: one place for date parsing, day validation and display formats.
- Runtime: neutral (`Date` and `Intl` only; no DOM). Existing homes: `library/paper/date.ts` (`formatDateTime`, `formatDay`), `library/paper/elapsed.ts` (`formatRelativeTime`), `spaces/viewModel/formatLocalDay.ts`.
- Absorbs:
  - Three validators of `YYYY-MM-DD` with different strictness: `isCalendarDate` (`writing/project/projectFile.ts:71`, round-trip check), `isIsoDay` (`library/paperMetadata.ts:70`, regex only), `isDay` (`spaces/model/json/fieldChecks.ts:11`, round-trip). These can disagree on `2026-02-30`; one `isCalendarDay` removes that.
  - Display formatters: `formatDate` (`libraryUi/dom/list/tray/fileFacts.ts:29`, hand-rolled month table), `shortDate` (`writing/checklist/sidebar/checklistRows.ts:50`), `time`, `dateTime`, `dayLabel` (`writing/history/dom/mountProjectHistory.ts:8-11`), `when` x2 (`vscode/src/writing/history/historyPanel.ts:55`, `browser/src/writing/history/historyHost.ts:16`), `stampText` and `nextDay` (`spaces/viewModel/icsExport.ts:34-38`).
- Public API: `isCalendarDay(value: unknown): value is string`, `formatDay`, `formatDateTime`, `formatShortDate(iso: string): string`, `formatClockTime(iso: string): string`, `formatDayLabel(iso: string, now?: number): "Today" | "Yesterday" | string`, `formatRelativeTime`, `nextDay(day: string): string`.
- Callers to update: about 10 files. Judgment call: the display formatters differ in locale (`[]` vs `"en"` vs `"en-US"`); folding them changes visible text, so take the locale as a parameter or decide one locale first. `formatDate` using UTC while `dateTime` uses local time is a real difference and should be kept as two named functions.

### `core/path`

- Purpose: path math that works with and without `node:path`.
- Runtime: neutral, built on the injected `PathOps` port; `node/` variant only for filesystem-touching confinement.
- Existing home: `posixPathOps` lives in `library/mutations/pathOps.ts` and the `PathOps` interface in `library/mutations/mutationDeps.ts` (fan_in 79), a mutation-specific file that 79 files import for a path port. Moving both to `core/path/pathOps.ts` is the largest single re-point in this section and needs no logic change.
- Absorbs (all pure, `[]` or `iface:PathOps` effects):
  - `baseName` x4 (`import/bibtex/BibtexService.ts:15`, `writing/allProjects/dom/tray/projectTrayFacts.ts:12`, `browser/src/libraryUi/editorArea/tabKinds.ts:10`, plus a `vscode.Uri` variant at `vscode/src/writing/tree/projectFileCommands.ts:17` that stays in vscode).
  - `folderOf` x2 (`typst/language/project/projectPaths.ts:34`, `writing/quotes/deriveCitationEntries.ts:21`), `directoryOf` (`library/conflicts/projectConflict.ts:23`), `directory` (`library/writeRecords/writeRecords.ts:37`).
  - `extensionOf` x2 (`writing/project/buildRoot/buildRootDetection.ts:14`, `library/conflicts/projectConflict.ts:24`), `stemOf` (`typst/language/project/projectSymbols.ts:75`), `fileStem` (`library/mutations/import/paperImport.ts:80`).
  - `isInside` x3: `latex/build/node/findProblems.ts:15` and `vscode/src/library/node/offerLibraryMove.ts:19` use `node:path` (effects `node-path`); `vscode/src/writing/buildRootDocument.ts:12` is the `PathOps` form and is exported. The exported PathOps form should win; the other two become callers with `nodePathOps`.
- Public API: `PathOps` (type), `posixPathOps`, `isInside(paths: PathOps, folder: string, file: string, options?: { allowEqual?: boolean }): boolean` (policy in 3.4), and string-only helpers over `posixPathOps`: `baseName(path)`, `parentOf(path)`, `extensionOf(path)`, `stemOf(path)`. `core/path/node/nodePathOps.ts` exports the `node:path` implementation so no host builds its own.
- Callers to update: about 16 for the helpers, 79 for the `PathOps` move (import path only).
- Not folded: `bridge/node/pathConfinement.ts` `segmentsOf` (node-path, security-sensitive) stays; `segmentsOf` in `pathOps.ts` is internal.

### `core/errors`

- Purpose: normalise a thrown `unknown` into text, an `Error` or a code.
- Runtime: neutral. Existing home: `logging/logEntry.ts` already exports an error-message helper used by logging.
- Absorbs: `message` (`spaces/store/readSpace.ts:6`) and `describeError` (`templates/host/publishContext.ts:16`), both `error instanceof Error ? error.message : String(error)`; `toError` (`templates/host/publishContext.ts:17`) and `asError` (`spaces/store/updateSpace.ts:16`); `errorCode` (`latex/toolchain/node/managedTex/toolsDirLock.ts:28`) and `errnoCode` (`bridge/node/pathConfinement.ts:9`) with an identical body; `isAbort` (`browser/src/storage/tabLease.ts:16`). The inline `error instanceof Error ? error.message : String(error)` idiom is also repeated in many call sites that are not units of their own; run the count once before the change.
- Public API: `errorMessage(error: unknown): string`, `toError(value: unknown): Error`, `errorCode(error: unknown): string | undefined` (reads `.code` safely, no Node type needed), `isAbortError(error: unknown): boolean` (checks `name === "AbortError"`, not `DOMException`, so it works in Node and workers).
- Callers to update: about 8 files plus the inline sites.
- Judgment call: `describePdfError` (`import/pdf/parser/readPdf.ts:9`), `toBridgeError` x2 and `errorCodeOf` (`vscode/src/relay/oauthCallback.ts:34`) map to domain error classes and stay local.

### `core/encoding` and `core/hash` (extend, no new module)

- Purpose: finish the existing byte, hex, base64 and SHA-256 helpers so no file re-implements them.
- Runtime: neutral (`crypto.subtle`, `TextEncoder`, `btoa`); `Buffer`-based code stays under `node/`.
- Absorbs:
  - `sha256Hex` (`writing/history/projectHistory.ts:11`): same job as exported `deriveSha256Hex`; delete it.
  - `deriveTextHash` (`writing/conflict/versionJournal.ts:4`), `deriveMirrorHash` (`collab/mirror/mirrorContext.ts:45`, with a private `encode` for string or bytes), `deriveCodeHash` (`qmd/cellOutput/cellSource.ts:8`, normalises then hashes): all three are `deriveSha256Hex(new TextEncoder().encode(x))`. Add `deriveTextSha256Hex(content: string | Uint8Array)` and keep only the normalisation in `cellSource`.
  - `toBase64` (`templates/host/thumbnailUri.ts:10`): is `bytesToBase64` from `encoding/base64.ts` with chunking; check that the exported one chunks, then delete.
  - `hexToBytes` (`share/shareCipher.ts:46`): add next to `bytesToHex` in `encoding/hex.ts` with strict validation (the private one accepts odd or non-hex input).
  - `sameBytes` x2 (`browser/src/storage/libraryLocation/copyVerified.ts:6`, `collab/mirror/fileSystem/libraryMirrorFileSystem.ts:9`, same body): add `sameBytes(a, b)` to `encoding/`.
  - `cryptoFill` x2 (`qmd/items/itemId.ts:12`, `spaces/model/spaceId.ts:25`): one `fillRandom(bytes)` over `crypto.getRandomValues`.
  - `decodeKey` x2 (`collab/invite/invite.ts:43`, `share/shareLink.ts:51`): both `base64UrlToBytes` then a length check inside try/catch; add `decodeKeyBytes(text, length): Uint8Array | undefined` to `encoding/base64url.ts`. The shareLink copy has a regex pre-check and a TRAP comment that must move with it.
- Callers to update: about 11 files. `hashOf` (`library/node/libraryLocation/moveLibrary.ts:64`) uses `node:crypto` streaming for large files and stays in `node/`.

### `core/url`

- Purpose: parse a URL once and ask it for host or origin without throwing.
- Runtime: neutral (`URL`).
- Absorbs: `hostOf` x4 (`import/landing/pageFacts.ts:49`, `import/pdfFinder/client/signatures.ts:46`, `import/pdfFinder/engine/hostPacer.ts:34` which takes a `fetch` input, `browser/src/libraryUi/host/handlers/addFromTabHandler.ts:8`; the homonym verdict is identical-subset), `originOf` (`browser/src/capture/tab/helperTab.ts:59`), `normaliseOrigin` (`helper/node/connection/upgrade.ts:17`), `parseUrl` (`import/pdfFinder/rules/findRule.ts:32`).
- Public API: `parseUrl(value: string): URL | undefined`, `hostOf(value: string): string` (lower-case hostname, `""` when invalid), `originOf(value: string | undefined): string | undefined`.
- Callers to update: about 8. Needs one test to pin whether `www.` is stripped, since the four `hostOf` copies are only a subset of each other.

### `core/text/lines`

- Purpose: offset and line arithmetic on a string.
- Runtime: neutral. Existing home: `writing/text/lineOffsets.ts` (fan_in 4).
- Absorbs: `lineAt(text, offset): number` x3 with the same signature (`browser/src/collab/comments/commentThreads.ts:38`, `browser/src/collab/projectShareEntry.ts:27`, `vscode/src/writing/preview/buildRoot/createProjectPreprints.ts:15`; clone family 51), `lineEnd` x2 (`latex/hover/findMathSpan.ts:81`), `lineStarts` (`vscode/src/collab/comments/sourceRanges.ts:10`).
- Public API: move `lineOffsets` to `core/text/lineOffsets.ts` and add `lineAt(text: string, offset: number): number`, `lineEnd(text: string, from: number): number`.
- Callers to update: about 6, three of them in vscode and browser that cannot reach `writing/` today without a deep import.

### `core/json`, `core/events` and `core/files`

Specified in section 3: `core/json` `parseJsonObject(text): Record<string, unknown> | undefined` (3.11, family #95 #96, natural canonical is `writing/project/deviceLocal/parseJsonObject.ts`); `core/events` `createListeners<T>()` (3.6); `core/files/node` `isDirectory`, `isFile` (3.7). `readJson` stays local to `relay` (3.12: three different inputs and failure results); an earlier proposal of a `core/http/readJson` module is dropped.

### Generic-looking helpers that stay local

- `join` (6 homonyms), `encode`/`decode` (collab `Y.Text` anchors in `collab/binding/relativeSelection.ts` and `collab/comments/commentAnchor.ts`, different encodings), `split*` in `reader/text/referenceSplit.ts` and `writing/versions/derivePageBlocks.ts`: domain algorithms that only share a name.
- `escapeLatex`, `escapeTypstString`, `escapeIcsText`, `escape` (`writing/checks/anonymityRules.ts:42`): each escapes a different grammar; `core/ui/escapeHtml.ts` (fan_in 34) is the only escape worth sharing.
- `slug` (`spaces/model/spaceId.ts:7`), `truncate` (`libraryUi/copyRequest/copyRequestMailto.ts:89`), `titleCaseName`, `squash`, `normalizeLineEnds`: single copies with one caller, nothing to fold yet.
- `exists` x4 and `isDirectory`/`isDir` x3 (`library/node/libraryLocation/detectLibraryFolder.ts:14`, `detectSyncFolders.ts:110`, `nativeHost/node/layout/browserDetection.ts:43`): `node/` filesystem probes; a `core/node/fs` module is possible for the three identical `isDirectory` copies (clone family 11), but `exists` is a different thing in each runtime (KV, `node:fs`, `vscode.Uri`).
- `readText` x4, `readBytes` x2: wrap a different port each time (library filesystem, `vscode.Uri`, project context).
- `walk` x14 and `visit` x4: tree walks over different data.
- `pad`, `count`, `number`: view formatting inside one DOM file each.

## 5. Target directory structure

Shared principles: (1) a domain keeps `<domain>/{*.ts neutral, node/, dom/}` and apps keep the same shape; (2) one file per concept, 100 to 400 lines, `index.ts` only re-exports; (3) subfolders only for a concept with several real modules or a surface above about 25 files; (4) shared modules (`path`, `url`, `guards`, `json`, `events`, `time`, `async`, `errors`, `text`, `files`, plus the existing `encoding` and `hash`) are top-level core folders reserved in 5.1, one to three files each; (5) `activation` and `command` in vscode stay as they are; (6) a helper using `node:path` or `node:fs` goes under `<module>/node/`, neutral code takes an injected `PathOps`.

### 5.1 Core target tree

Rules behind the tree: level 1 is a concept (the domains above, plus the shared slots); level 2 is a runtime folder (`node/`, `dom/`, `worker/`) only where a concept needs it, otherwise a module file; level 3 is a module folder, only for a surface of more than about 5 files (`dom/list/`). Runtime folders stay at domain level because the three entry points (`@labshelf/core`, `/node`, `/dom`) and the neutral tsconfig check are built from them; a module therefore has up to three files with the same stem (`library/layout.ts`, `library/node/layout.ts`). `index.ts` files only re-export, one per domain and per module folder.

```
packages/core/src/
  index.ts                       neutral entry (@labshelf/core); node.ts / dom.ts / math.ts entries unchanged
  model/  ports/  logging/       shared types, host interfaces, log format      (8+7+3 -> 4+2+2)
  encoding/  hash/               bytes, base64, SHA-256                         (5 -> 2)
  path/  url/  guards/  json/  events/       shared modules of section 4 (1 to 3 files each)
  time/  async/  errors/  text/  files/      files/ holds node/ only (fsProbe, writeFileAtomic)
  library/                       layout, record, mutations, conflicts, search   (101 -> ~20)
    node/                        location, deviceState, atomic writes
  import/                        identifiers, registries, search, pdf, landing, paper, bibtex   (142 -> ~34)
    node/                        ocr, native pdf readers
    pdfFinder/                   finder, client, engine, hostPacer, rules, platforms  (47 -> 9)
      resolvers/                 openAccess, indexes, matching
  reader/                        protocol, host, sidecar, navigation, text      (119 -> ~38)
    dom/                         session, chrome, hover, preview, navigation, sidebar, highlights  (77 -> ~22)
  libraryUi/                     protocol, store, viewModel, citationMap        (124 -> ~36)
    dom/                         list/, detailPane/, sidebar/, editorArea, flows (73 -> ~20)
  writing/                       project, citations, build, checks, history, search, synctex   (218 -> ~50)
    node/                        project export, build runner, history, conflict adapter
    allProjects/                 library, protocol, viewModel, dom/            (39 -> 12)
    dom/                         search, history, checklist
  latex/                         build, source, catalog, log, biber, toolchain  (87 -> ~18)
    node/                        toolchain (managedTex, systemTex, verify), build runner, biber
  typst/                         language, stdlib, root                         (43 -> 13)
    node/                        compiler host, package store, session
  collab/                        doc, mirror, relays, session, peer, invite     (113 -> ~30)
    node/                        deviceState, mirror file system
    dom/                         comments / presence bits
  share/                         share, flows, http                             (25 + 19 moved -> ~9)
    dom/  node/                  dialogs, share-link import
  relay/                         client, account, oauth, connection             (39 -> ~10)
    worker/                      the Cloudflare Worker (neutral-only imports)   (8 -> 3)
  spaces/  templates/            see table: model+store, protocol+viewModel; manifest, sources, host   (50 -> 12, 70 -> 17)
    dom/  node/                  surfaces; catalog and install
  helper/  bridge/  nativeHost/  host processes: protocol (neutral) + node/    (44 + 13 + 13 -> 11 + 5 + 3)
  ai/                            service, chunk, embedding, ingestion           (20 -> 6)
    node/                        sqlite vector store
  qmd/                           editor, items, conflict                        (25 -> 9)
  ui/                            tokens, icons                                  (40 -> 11)
    dom/                         elements, widgets, settings
```

| Level | Logic | Count today | Count in the target |
|---|---|---|---|
| `src/<domain>` | One concept; contains its own barrel. | 22 domains + 4 root slots | 22 domains + 10 new shared modules (`path`, `url`, `guards`, `json`, `events`, `time`, `async`, `errors`, `text`, `files`) |
| `src/<domain>/<runtime>` | Runtime folder only if code needs `node:*` or the DOM. | 40 runtime folders (node, dom, worker) | about 22 (merges `collab/dom`, `reader/node`, `spaces/dom` etc. into their domain's runtime folder) |
| `src/<domain>/<module>/` | Only for surfaces over 5 files and `pdfFinder/resolvers`. | 268 directories, 119 at depth 3+ | about 55 directories, at most depth 3 |
| files | 100-400 lines, one concept | 1309 non-barrel, 604 under 40 L | about 300 non-barrel files, median about 140 L, largest about 400 L |
| barrels | `index.ts` re-export only | 264 | about 70 (one per domain, runtime folder and module folder) |

Judgment calls: (1) runtime folders stay at domain level, which keeps the entry-point and neutral-tsconfig machinery intact but costs a same-stem split across up to three folders; (2) `share` absorbs the sharing UI of `libraryUi` and `collab` (19 files) because c114/c105/c136 show it is one flow; (3) `writing/conflict` merges into `library/conflicts` (c10) with a thin project adapter; (4) typst stdlib stays as data tables (c206 purity 0.76, no fragmentation to repair); (5) the 300-line limit has to move to 400 for this tree (section 6).

### 5.2 VS Code target tree

Levels: `src/` holds one folder per concept plus `extension.ts`. A module folder holds files of one concept (about 100 to 400 lines) and a single `index.ts` that re-exports the public API. A `node/` subfolder exists only where Node code exists, as dependency-cruiser requires. `writing/` is the only second level of modules.

```
packages/vscode/src/
  extension.ts                  composition entry, imports activation/node (only file allowed to)
  activation/                   V1  composition root (7 files)
    index.ts
    startup.ts  services.ts  hostAdapters.ts  libraryRoot.ts
    registerViews.ts  registerCommands.ts  externalChanges.ts
    node/                       (2 files + index) desktop adapters, native host, logging, storage
  library/                      V2  (5 files)  paperService.ts  location.ts  conflicts.ts  syncGuide.ts  events.ts
    node/                       sharedLibraryConfig.ts  offerLibraryMove.ts
  commands/                     V3  (5 files)  import.ts  metadata.ts  textLayer.ts  folders.ts  register.ts
  libraryUi/                    V4  (9 files)  sidebarView.ts  listPanel.ts  feed.ts  handlers.ts  details.ts
                                               citationMap.ts  organizer.ts  paths.ts  webview.ts
  spaces/                       V5  (2 files)  view.ts  addToSpace.ts
  reader/                       V6  (3 files + node/)  panel.ts  shell.ts  webview.ts   node/pdfjs.ts
  relay/                        V7  (3 files)
  share/                        V8  (2 files + node/)
  collab/                       V9  (4 files + node/ 3)  binding.ts  comments.ts  presence.ts  register.ts
                                               node/session.ts  node/editors.ts  node/commands.ts
  latex/                        V10 (3 files)  labels.ts  project.ts  completion.ts
  webview/                      V11 (2 files)  transport.ts  bundleMissing.ts
  writing/                      V12..V21
    index.ts                    registerWriting
    commands/                   V12 (4 files)
    build/                      V13 (5 files + node/ 2)  toolchain, includeOnly, check, builds
    typst/  figures/  history/  V14..V16 (2 to 3 files each, each with node/ when it spawns)
    preview/                    V17 (7 files)  panel.ts  buildRoots.ts  citations.ts  synctex.ts  limits.ts  ports.ts  diagnostics.ts
    citations/                  V18 (5 files)
    projects/                   V19 (7 files)  sidebar.ts  tree.ts  outline.ts  checklist.ts  allProjects.ts  session.ts  platformPort.ts
    search/  templates/         V20, V21 (2 files each)
```

| Level | Logic | Count |
|---|---|---|
| `src/` | one folder per product concept, plus `extension.ts` | 11 folders, 1 file |
| `src/writing/` | one folder per Writing sub-feature | 9 folders, `index.ts` |
| module folder | files of one concept, `index.ts` only re-exports | 2 to 9 files each |
| `node/` (inside a module) | spawn, disk and Node-only code, imported only from `extension.ts` through `activation/node/` | 2 to 3 files, 10 folders |

Depth stays at most 3 below `src/` (`writing/build/node/`); today it also reaches 3 (`writing/preview/citations`, `collab/node/commands`), so the gain is in file count, not depth. Directories fall from 79 to about 38; non-barrel files from 319 to about 85; barrels from 69 to about 25.

### 5.3 Browser target tree

Levels: top level splits by extension surface where the manifest needs it (`background`, `content`, `popup`, `options`) and by concept for the rest. Pages (library, reader) are bootstrapped from `libraryUi/`. There is one composition root per surface, not one global root. No file imports from a sibling surface (`popup` does not import `options`).

```
packages/browser/src/
  background/     B1  worker      (5 files)  entry.ts  handlers.ts  offers.ts  drafts.ts  copyRequest.ts
  content/        B2  content     (3 files)  entry.ts  identifiers.ts  searchPage.ts
  capture/        B3  dom         (5 files)  pageProbe.ts  pdfFinding.ts  tabFetch.ts  accessWatches.ts  attach.ts
  popup/          B4  dom         (4 files)  entry.ts  captureFlow.ts  render.ts  offerCard.ts
  options/        B5  dom         (5 files)  entry.ts  sections.ts  readerForm.ts  shareSection.ts  helperSection.ts
  libraryUi/      B6  dom         (17 files)
    pages/                        libraryPage.ts  readerPage.ts  spaces.ts
    editorArea/                   tabs.ts  workspace.ts  panes.ts  tabKinds.ts  ...   (5 files)
    host/                         handlers.ts  snapshots.ts  context.ts   (3 files)
    sidebar.ts  details.ts  prefs.ts  paperLink.ts
  writing/        B7  dom         (12 files)
    editor.ts  source.ts  session.ts  history.ts  projectList.ts
    preview/                      scheduler.ts  builds.ts  assembly.ts   (3 files)
    languages/                    latex.ts  typst.ts  templates.ts       (3 files)
  storage/        B8  dom         (12 files)
    idb.ts  records.ts  staging.ts  tabLease.ts
    bridge/                       connection.ts  fileSystem.ts           (2 files)
    library/                      location.ts  move.ts  pickedDir.ts     (3 files)
  collab/         B9  dom         (6 files)  pageShares.ts  comments.ts  mirror.ts  keys.ts  register.ts  shareRegistry.ts
  helper/         B10 dom         (6 files)  connection.ts  project.ts  setup.ts  updateTracker.ts  client.ts  index
  relay/          B11 dom         (3 files)
  platform/       B12 dom/worker  (5 files)  bx.ts  messages.ts  settings.ts  logging.ts  theme.ts
```

| Level | Logic | Count |
|---|---|---|
| `src/` | extension surfaces and concepts | 12 folders, no files |
| module folder | files of one concept; `index.ts` only re-exports | 3 to 12 files |
| second level (`libraryUi/*`, `writing/*`, `storage/*`) | a sub-concept that has at least 3 files of its own; otherwise plain files | 7 folders |

Depth is at most 2 below `src/` (`libraryUi/editorArea/`, `writing/preview/`); today it reaches 3 (`libraryUi/host/handlers`, `writing/source/actions`). Directories fall from 58 to about 22; non-barrel files from 252 to about 85; barrels from 52 to about 20. The runtime of each folder stays uniform except `platform/` (worker and dom), which already holds only chrome wrappers that both can import.

## 6. Conflicts with current rules

| Rule | Source | Effect on the target | Change needed |
|---|---|---|---|
| `no-import-past-index`: one rule per directory, outside code imports only `index.ts` | `.dependency-cruiser.cjs` lines 15 to 41 | Forces an `index.ts` in every directory that is imported from outside (385 barrels, 2634 lines). Merging files inside one directory does not conflict; creating a leaf directory per concept does. | Keep for domain and runtime folders; stop requiring a barrel for leaf concept folders: either make the rule apply only to directories at depth <= 2 (domain/feature) and runtime folders, or allow imports of a sibling file inside the same domain. |
| `lint:dirs` minimum: a leaf subfolder needs >= 2 source files besides `index.ts` | `scripts/checks/directorySize.mjs` (`MIN_FILES = 2`) | Produced the 87 leaf dirs with <= 2 files by encouraging tiny pairs; the target (one module per concept) creates one-file folders. | Drop the minimum, or lower it to 1; keep the exemptions. |
| `lint:dirs` maximum 25 files per folder | same (`MAX_FILES = 25`) | No conflict today (largest dir has < 25 non-barrel files); fewer, larger files only helps. | Keep. |
| eslint `max-lines` 300 and `max-lines-per-function` 50 for `**/*.ts` (tests: 500 and function limit off) | `eslint.config.mjs` | A 400-line module breaks the 300 cap; function cap 50 is not binding (lines/unit is 5 to 14). | Raise the source `max-lines` to 400 (keep tests at 500); keep the function limit. No file in `src` has an `eslint-disable max-lines` override. |
| Architecture: "related files are grouped in subfolders once there are more than eight" | `architecture#core` | Pushes folders with 9 files into subfolders, which is the cause of the directories with 2 tiny files. | Replace by: group into subfolders only when a folder passes ~25 files or a subfolder is a named concept with >= 2 modules. |
| `lint:naming` | `scripts/checks/naming.mjs`, `vocabulary.yaml` | Folder, file and export names must be vocabulary terms. A merged module needs a name from existing terms; free words are allowed in file names after a term. No new terms needed. | None, but a merged file keeps exports named per verb/term (checked per export, not per file). |
| `jscpd` baseline | `scripts/checks/duplicates.mjs`, `duplicatesBaseline.json` | Merging duplicates lowers the count; the baseline must be lowered with `--update` in the same change or the gate stays loose. | Run `pnpm jscpd:update-baseline` after each deduplicating slice. |
| `knip` | `package.json` lint script | New shared modules must be used; unused exports fail. | None. |
| `rules.md` Code/Placement | `rules#placement` | "Two apps never hold copies of the same code": the vscode and browser copies of helpers are a rule violation, not just debt. | None; cite it for the dedupe slices. |


## 7. Execution order

Each slice is a separate future session: merge or move, rewrite every caller, delete the old code, lower the jscpd baseline (R-jscpd), run the gate. Shared modules come first because they absorb duplicates in every domain; domain slices follow by fragmentation (1.3) and risk; app slices come after the core they depend on; the last slice deletes app copies of core code. Rule labels refer to section 6: R-index (barrel rule), R-min (leaf folder minimum), R-400 (`max-lines` 400), R-doc (architecture "more than eight" sentence), R-jscpd (baseline update, always). Typing references are to `analysis/typing.md` section 6 (the brand and its constructor go in the same slice as the module). Test counts are files under `packages/<pkg>/__tests__/<area>`; `packages/terminal` (60 files) consumes core and must be run in every core slice.

| Slice | Modules | Files (approx.) | Absorbs (§3) | Rules first | Risk | Depends on |
|---|---|---|---|---|---|---|
| S0 | rule changes only | 5 config files, 2 docs | none | R-index, R-min, R-400, R-doc | L | none |
| S1 | `core/path` (PathOps move, string helpers) | 79 import re-points + 16 | H (path helpers) | R-min | M | S0 |
| S2 | `core/path` `isInside` | 3 named + 9 inline sites | C | none | H | S1 |
| S3 | `core/url` | 8 | D | R-min | L | S0 |
| S4 | `core/guards`, `core/json` | 34 + 4 | A, B, J (#95 #96), H (`isCallId`) | R-min | M | S0 |
| S5 | `core/time`, `core/async` | 10 + 28 | none (helpers only) | R-min | M | S0 |
| S6 | `core/errors` | 8 + inline | none (helpers only) | R-min | L | S0 |
| S7 | `core/encoding`, `core/hash` | 11 | G (`sameBytes`), H (`randomSuffix`), J (#85) | none | M | S0 |
| S8 | `core/events` | 4 classes + 9 inline | E | R-min | M | S0 |
| S9 | `core/text`, `core/files/node`, G `readStable` | 6 + 8 + 2 | F, G, J (#57 #58) | R-min | L | S1 |
| S10 | `ui`, `model`, `ports`, `logging` | ~75 | J (dialog helper) | R-index, R-400 | M | S1 to S9 |
| S11 | `import` (pdfFinder, registries) | 142 to ~34 | none | R-index, R-400 | M | S3, S4 |
| S12 | `latex`, `typst` | 130 to ~31 | J (#73) | R-index, R-400 | M | S1, S2 |
| S13 | `library` (+ `writing/conflict` into `library/conflicts`) | 101 + ~45 to ~25 | none | R-index, R-400 | H | S1, S2, S7 |
| S14 | `writing` core (project, citations, build, checks, history) | ~150 to ~35 | none | R-index, R-400 | H | S1 to S7, S13 |
| S15 | `writing/allProjects`, `spaces`, `templates` | 160 to ~41 | H (path comparator) | R-index, R-400 | M | S4, S14 |
| S16 | `reader`, `libraryUi` (+ `share` absorption) | 243 + 19 to ~80 | H (`titleOf`), J (#129 #130) | R-index, R-400 | H | S4, S10 |
| S17 | `collab`, `share`, `relay` | 177 to ~49 | E, G, H (`decodeKey`) | R-index, R-400 | H | S7, S8, S9 |
| S18 | `helper`, `bridge`, `nativeHost`, `ai`, `qmd` | 140 to ~34 | F | R-index, R-400 | H | S9 |
| S19 | vscode `writing` (preview, build) | 191 to ~50 | J (#167 #171 #175) | R-index | M | S14 |
| S20 | vscode other modules (V1 to V10 except writing) | rest of vscode | H (dispose, session logger, channel) | none | M | S13, S16, S17 |
| S21 | browser modules | 3 hotspots, storage 36 files | J (#213 #215) | R-index | M | S16, S17 |
| S22 | delete app copies of core code | ~25 files in both apps | clone families 14, 51, 136, 103, 200, 201, 47 | none | H | S19 to S21 |

Notes per slice (tests are files; typing from `analysis/typing.md` section 6):

- S0. Config and docs only; run `pnpm lint` and the naming lint test (`scripts/checks`). Needed first because every shared module starts as a one-file folder (R-min) and domain slices create 400-line files (R-400) and leaf concept folders (R-index). Typing: none.
- S1. Moves `PathOps` and `posixPathOps` out of `library/mutations`, adds `nodePathOps` under `path/node`. Import-only for 79 files, hence M. Tests: core library 78, latex 52, writing 141, collab 62; vscode writing 95, library 9. Typing: `AbsolutePath`, `LibraryPath`, `ProjectPath`, `RelativePath` and their constructors here.
- S2. Decision needed first: `isInside(paths, folder, file, { allowEqual })`, `..` prefix rule (`..notes`), the argument flip in `offerLibraryMove.ts:19`, and the Windows case in `typstBuilds.ts:36` (3.4). H because it changes which files may be sent into a build and where library moves are allowed. Tests: core latex 52, library 78, writing 141; vscode writing 95, collab 7, library 9; add the equal-path, `..notes` and another-drive cases. Typing: path brands from S1.
- S3. `hostOf` pinned by one test (www is not stripped); `hostPacer` keeps `.host`. Tests: core import 84; browser libraryUi 21. Typing: `WebUrl`, `RelayUrl`.
- S4. Two loose `isRecord` copies in `relay/client` accept arrays; `isNum` in `reader/previewRequests.ts` may accept `NaN`. Protocol parsers sit under the contracts `library-ui-host.md`, `reader-host.md`, `spaces.md`, `templates.md`, `share-link.md`, `relay.md`. Tests: core libraryUi 75, reader 69, spaces 22, templates 37, share 14, relay 19, collab 62, writing 141; browser libraryUi 21, collab 12. Typing: the shared parse helper that replaces the ten `isText` copies, so `as Record<string, unknown>` casts go here.
- S5. 25 inline debounce timers: behaviour is timing-sensitive, hence M; use fake timers. Tests: core reader 69, library 78, spaces 22; vscode latex 8; browser libraryUi 21. Typing: none.
- S6. `errorMessage`, `toError`, `errorCode`, `isAbortError`; error classes in `describePdfError` and `toBridgeError` stay. Tests: core spaces 22, templates 37, latex 52, bridge 9, logging 3; browser storage 23. Typing: none.
- S7. `hexToBytes` becomes strict and `decodeKeyBytes` carries a TRAP comment from `shareLink.ts`; crypto and link formats are under `share-link.md` and `collaboration.md`. Tests: core encoding 2, hash 1, share 14, collab 62, qmd 11, spaces 22, templates 37. Typing: `Sha256Hex` (with `ShareId`, `RelayToken` in S17).
- S8. Do not unify emit/error isolation; adopt `emit` per emitter after reading it. Tests: core library 78, spaces 22, collab 62; browser collab 12, writing 28, spaces 3. Typing: none.
- S9. `fsProbe` (3 identical `isDirectory`), `lineAt`/`lineEnd` into `text`, `readStable` for the mirror read (logic identical, `sample` differs). Tests: core library 78, latex 52, typst 14, nativeHost 7, collab 62. Typing: none.
- S10. `formatError` (122 users) and `renderElement` (104) have the highest fan-in; ui/dom is hotspot 6. Contracts: none; the visual surface is checked by the DOM tests. Tests: core ui 24, model 4, logging 3, ports via library 78. Typing: `PaperId`/`CiteKey` live in `model` (do with S13).
- S11. Hotspot 1 (pdfFinder 47 to 9) and 12 (registries). Tests: core import 84. Typing: `Doi`, `ArxivId`, `Pmcid`, `Pmid`, `OpenAlexWorkId` in `import/identifiers`; merge `ResolvedMetadata` and `PaperRecordMetadata` here.
- S12. Hotspots 5, 8, 17 (latex toolchain, build, source). The toolchain is covered by `managed-tools.md`. Tests: core latex 52, typst 14; vscode latex 8; browser latex 1, typst 1. Typing: none.
- S13. Hotspots 10, 11, 13; contract `library-format.md` (folder names, paper ids). 79 files import `mutations`. Tests: core library 78; vscode library 9; terminal library 8. Typing: `PaperId`, `CiteKey`; merge `CiteKeyMetadata`/`WorkReference`.
- S14. Hotspots 2 and 9; largest area (writing 218 files). Split into two sessions if the first goes over a day. Tests: core writing 141; vscode writing 95; browser writing 28. Typing: `ProjectId`, merged with `helper/helperPaths.ts::isHelperProjectId` (finish in S18).
- S15. Hotspot 20 (`spaces/dom`) and 15 (`templates/node`); contracts `spaces.md`, `templates.md`. Tests: core writing/allProjects (inside 141), spaces 22, templates 37; vscode spaces 4; browser spaces 3. Typing: `SpaceId` and item ids; protocol parsers.
- S16. Hotspots 14 and 18; contracts `library-ui-host.md`, `reader-host.md`, `details-host.md` cross the vscode and browser webview boundary, hence H. Tests: core libraryUi 75, reader 69, share 14; vscode libraryUi 15, reader 6; browser libraryUi 21, reader 3; terminal libraryUi 24. Typing: protocol parsers for libraryUi and reader.
- S17. Hotspot 19; contracts `collaboration.md`, `sync.md`, `share-link.md`, `relay.md`; the relay worker runs as a Cloudflare Worker with neutral-only imports. Tests: core collab 62, share 14, relay 19; vscode collab 7, share 3; browser collab 12, relay 5, share 1. Typing: `ShareId`, `RelayToken`, `Sha256Hex`; merge `Invite`/`StoredInvite`.
- S18. Hotspot 4 (`helper/node`); separate processes with contracts `helper.md`, `bridge.md`, `native-host.md`, `qmd-items.md`, so the runtime boundary is the risk. Tests: core helper 24, bridge 9, nativeHost 7, ai 11, qmd 11; browser helper 4; terminal helper 4. Typing: finish `ProjectId` for helper.
- S19. Hotspots 3 and 7. Webview entries are not merged until the bundler is checked. Tests: vscode writing 95. Typing: none; follows S14 signatures in the same change.
- S20. V1 to V10 except writing; `activation` and `command` stay. Tests: vscode activation 6, command 6, library 9, libraryUi 15, collab 7, reader 6, share 3, spaces 4, storage 5, ui 2. Typing: vscode signatures of the core types.
- S21. Hotspot 16 (`editorArea`) and storage (107 units in 36 files). Tests: browser storage 23, libraryUi 21, collab 12, capture 8, background 6, platform 6. Typing: browser `TabId`, `LibraryId`, IndexedDB keys.
- S22. Moves the "belongs in core" lists of 2.2 and 2.3 into core and deletes the app copies (rules.md: two apps never hold copies of the same code). Cross-package, so H. Tests: vscode 168 and browser 128 files in full, core areas that receive the code. Typing: none.

