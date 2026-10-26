# Domain types for core, vscode and browser: gain, cost, risk

Assessment of what `packages/core`, `packages/vscode` and `packages/browser` (product `src/`) would gain from branded or small value types for ids, paths, URLs, DOIs, cite keys and hashes. No product code was changed. Facts come from `analysis/labshelf.db` (see [README.md](README.md)); judgments are marked "(judged)". Reproduce the tables with:

```sh
node analysis/scripts/typing.mjs         # writes value_concepts (fine concept per row of `values`)
node analysis/scripts/typingReport.mjs   # prints the aggregates used below
```

## 0. Summary

| Fact | Number |
|---|---|
| Parameters, fields and class fields whose name names a concept (`values`) | 3,839 (2,595 params, 1,221 fields, 23 class fields) |
| Of which primitive (`string`/`number`) | about 3,200 (about 84%) |
| Branded or nominal types in product code today | 0. `PeerId = string` (`collab/transport/peerTransport.ts`) is a plain alias |
| Units with 2+ string parameters of different concepts (swap risk) | 160 (82 exported): core 103, vscode 24, browser 33 |
| Call sites where an `…Id` argument feeds a differently named `…Id` parameter | 26 of 16,373 named args; all benign renames |
| Name-level concept mismatches found (path/url/id/key/dir/doi) | 12 call sites; 0 real bugs after reading |
| Type escapes (`as`, `as-unknown-as`, `unknown`, `any`, `!`) | 623 / 21 / 1,045 / 4 / 575 |
| Validators that already exist per concept but return `boolean` or `v is string` | at least 14 (section 3.3) |

Main reading: the code base has no swap bug today, so typing is not a bug-fix campaign. The gain is (a) self-documenting signatures where bare `id`, `path`, `key`, `file` carry no concept, (b) turning the existing validators into the only construction points, and (c) removing the `as Record<string, unknown>` and `as SidebarToHost` casts at message boundaries by making a parse return a typed value. Cost is dominated by `paperId`, paths and URLs because they cross all three packages and every wire format.

## 1. Domain concepts that are primitive today

Method: `values` rows classified by name where the name carries the concept (`paperId`, `projectId`), by domain folder where it does not (bare `id`, `path`, `file`, `key`, `root`). A trailing `?` in the "fine" column means the domain decided (judged). Counts include fields in message types, so one concept appears many times per protocol. Collections (`ids`, `paths`) are excluded from the primitive counts and listed separately.

### 1.1 Identifiers

| Concept | core | vscode | browser | Total | Current type | Where it is born |
|---|---|---|---|---|---|---|
| paperId (named) | 78 | 48 | 31 | 157 | `string` | folder name under `papers/` (scan), `deriveCiteKey`/id generator on import ([contracts/library-format](../documents/contracts/library-format.md) "Paper identity"); equals the cite key |
| paperId (bare `id`, judged: libraryUi, library, reader, import, qmd) | 283 | 40 | 72 | 395 | `string` | UI messages `paper.*` (`id`), reader and details messages, view store selection |
| projectId (named) | 77 | 4 | 56 | 137 | `string` | folder name under `projects/`; helper protocol; browser project storage |
| projectId (bare `id`, judged: writing, templates) | 119 | 13 | 11 | 143 | `string` | same |
| spaceId / folderId / dateId / termId (spaces) | 123 | 18 | 3 | 144 | `string` | generated inside `spaces/store`, read from `space.json` / `glossary.json` |
| shareId | 60 | 14 | 16 | 90 | `string` | relay Worker (`relay/http/bodyFields.ts::isShareId`), share link, `storedShareKeys` |
| tabId | 0 | 0 | 40 | 40 | `string` (browser editor tabs; judged: `number` extension tab ids are separate) | browser UI and `chrome.tabs` |
| libraryId | 0 | 0 | 17 | 17 | `string` | browser `storage/libraryIdentity.ts`, tab lease names |
| docKey / docId (collab) | 38 / 14 | 0 | 1 / 4 | 57 | `string` (docId in `Envelope` is `Uint8Array`) | project file path used as doc key; `collabStore.ts` |
| threadId, workId, arxivId, folderId, templateId, other named ids | about 75 | about 15 | about 15 | about 105 | `string` | comments file, OpenAlex (`/^W\d+$/` in `isWorkId`), registries, template manifests |
| `id` with no domain reading (judged "unspecified") | 32 | 6 | 58 | 96 | `string` | browser `libraryUi`, `background` |
| Collections of ids (`ids`, `paperIds`, `takenIds`) | 54 | 20 | 13 | 87 | `string[]`, `Set<string>` | selection, bulk messages |
| cite key (named) | 11 | 0 | 0 | 11 | `string` | `library/paper/citeKey.ts`; `labshelf:` links |
| `key` bare, judged storage/map key | 91 | 26 | 15 | 132 | `string` | IndexedDB keys, `Map` keys, doc keys |
| `key` bare, judged cite or map key (libraryUi, library, reader, qmd) | 50 | 7 | 2 | 59 | `string` | `Map<string, …>` and sort keys; mixed meaning |

Observations:
- `paperId` is the dominant concept: named 157 plus about 395 bare, in 174+ files, crossing core, vscode and browser through the `paper.*` UI messages. The folder name, the paper id and the cite key are one string by contract.
- Bare `id` is the real loss. Across 364 resolved call sites with a parameter literally named `id`, 307 pass an argument also named `id`: the name never states the concept, so the concept only exists in the reader's head.
- `projectId`: the helper validates it separately (`helper/helperPaths.ts::isHelperProjectId`) from the writing code. Same string, two validators.
- Pure ids that are not strings (`docId` bytes, `shareKey` `Uint8Array`, `contentKey` `CryptoKey`) are already distinct types. Only `ShareSecret` and `DerivedShareKey` exist as named types.

### 1.2 Paths

| Concept | core | vscode | browser | Total | Current type | Where it is born |
|---|---|---|---|---|---|---|
| Library root / papers root / project root (`…Root`, string) | 142 | 98 | 15 | 255 | `string` | VS Code settings and folder picker; terminal config; `LibraryLayout<T>.root` |
| Absolute directory (`…Dir`, `…Folder`) | 152+20 | 37+43 | 25+6 | 283 | `string` | `node:path`, `os`, config; `projectFolder` is a VS Code workspace folder (36 in vscode) |
| File path, named (`filePath`, `pdfPath`, `mainFile`…) | 102 | 28 | 17 | 147 | `string` | `path.join`, glob |
| Bare `path`/`file`, judged absolute (vscode) | 0 | 146 | 0 | 146 | `string` | `vscode.Uri.fsPath`, `fs` |
| Bare `path`/`file`, judged project-relative `/`-separated (collab, writing, latex, typst) | 242 | 0 | 57 | 299 | `string` | project tree, `isProjectPath` validators |
| Bare `path`/`file`, judged library-relative (`papers/a/b`, libraryUi, library) | 95 | 0 | 21 | 116 | `string` | `isLibraryPath` in `libraryUi/protocol/messageGuards.ts` |
| Relative path (`relativePath`, `relPath`, `relFolder`) | 25 | 2 | 0 | 27 | `string` | `checkRelativePath` in `library/relativePath.ts` |
| Unspecified file path (browser virtual FS, others) | 96 | 0 | 55 | 151 | `string` | IndexedDB file system keys (`browser/src/storage`) |
| Collections (`paths`, `files`, `dirs`) | 32 | 42 | 8 | 82 | `string[]` | scans |

Distinct meanings hiding under one `string`: (1) absolute OS path, (2) library-relative `papers/…` path, (3) project-relative path, (4) browser virtual-FS path, (5) `Uri` (vscode, already a class). `IFileSystem` declares "paths are POSIX-style strings" (INVARIANT in `ports/fileSystem.ts`), and `LibraryLayout<T>` / `Join<T>` in `library/layout.ts` are already generic over the path type, so a branded path plugs into the layout without a new abstraction.

### 1.3 URLs, DOIs, hashes, tokens

| Concept | core | vscode | browser | Total | Current type | Where it is born |
|---|---|---|---|---|---|---|
| Web URL (`url`, `pdfUrl`, `pageUrl`, `finalUrl`, `articleUrl`…) | 156 | 9 | 49 | 214 | `string` | network (`import/`), content scripts, `chrome.tabs`; validated by `isWebUrl` (`libraryUi/protocol/messageGuards.ts`, a second one in `writing`) |
| Relay URL | 30 | 3 | 7 | 40 | `string` | settings and invites (`collab/invite/relayList.ts::isHttpsUrl`) |
| Webview / extension `Uri` | 7 | 69 | 0 | 76 | `vscode.Uri`/`string` (only 12 primitive) | VS Code API |
| Asset URL (wasm, cmap, icc, fonts, worker) | 9 | 2 | 1 | 12 | `string` | bundle config |
| DOI | 64 | 4 | 1 | 69 (66 primitive) | `string` | `import/identifiers/doi.ts::extractDoi`, `normalizeDoiCandidate`; metadata registries; `metadata.yaml` |
| arXiv id | 9 | 0 | 1 | 10 | `string` | `import/identifiers/arxiv.ts::normalizeArxivIdentifier` |
| PMCID, PMID, ISBN | few | 0 | 0 | about 4 | `string` | `import/identifiers/pmc.ts`, `pubmed.ts` |
| Hash (content, token, disk hash, `sha`, `etag`) | 54 | 0 | 15 | 69 | `string` | `hash/`, relay (`isSha256Hex`), blob store |
| Token (relay token, refresh token) | 37 | 5 | 0 | 42 | `string` | relay; `isRelayToken`; settings |
| Email, slug | 11 | 1 | 2 | 14 | `string` | contact settings, template slugs |

### 1.4 Where values are born (summary)

| Origin | Concepts | Boundary |
|---|---|---|
| Disk scan of folders | paperId, projectId, templateId, folder path | `library/scan`, `library/paperMetadata.ts` |
| `metadata.yaml` / `labshelf.yaml` / `space.json` / `projects.json` parsing | paperId (folder), doi, arxivId, cite key, url fields | `library/writeRecords`, `paperMetadata.ts`, `readSpace.ts`, `templateManifest.ts` |
| Message parsing (webview postMessage, browser runtime messages, helper socket, relay HTTP) | every id, library path, project path, url, doi, workId | `libraryUi/protocol`, `spaces/protocol`, `writing/allProjects/protocol`, `templates/protocol`, `helper/parseHelperMessage.ts`, `relay/http/bodyFields.ts`, `browser/src/platform/messages` |
| Storage (IndexedDB, JSON files, `localStorage`) | libraryId, tab lease names, doc keys, share keys | `browser/src/storage`, `collab/deviceState`, `libraryUi/store/prefs.ts` |
| Network | url, doi, arxivId, workId, hash | `import/registries`, `import/pdfFinder`, `relay/` |
| UI | selection (paperId), folder paths, typed text | `libraryUi/dom`, `spaces/dom` |
| Filesystem / OS | absolute paths, roots | `vscode`, `core/*/node`, terminal |

## 2. Gain

### 2.1 Swap risk: signatures with 2+ same-primitive parameters of different concepts

Computed: units whose primitive `string` parameters (collections excluded) map to 2+ different fine concepts. 160 units (82 exported) qualify: core 103, vscode 24, browser 33. Another 1,769 units have 2+ `string` parameters in total, so the 160 are the subset where the names prove different concepts; the rest are mostly texts, names and labels.

Top candidates (parameter name : concept):

| Unit | Parameters | Why it matters |
|---|---|---|
| `writing/conflict/fileProjectVersionStore.ts::version` | `projectId`, `relativePath`, `hash` | three strings, three concepts, one call |
| `writing/project/mutation/addExistingFolder.ts::checkIdIsFree` | `libraryRoot`, `file`, `id` | root directory, file, project id |
| `relay/worker/answerRelayRequest.ts::askRoom` | `shareId`, `path`, `tokenHash` | worker boundary |
| `collab/pageShares.ts::entry` | `shareId`, `libraryId`, `joinedId` | three ids of three kinds |
| `helper/client/project/updateTracker.ts::remember` | `requestId`, `projectId`, `path` | |
| `library/conflicts/conflictDismissals.ts::writeProjectConflictDismissal` | `file`, `path`, `hash` | `file` and `path` are two relative paths |
| `writing/conflict/node/spaces/spaceItemFileConflictMerge.ts::mergeSpace` | `spaceDir`, `spaceId`, `tmpDir` | two dirs plus an id |
| `reader/sidecar/paperSidecarStore.ts::updateAnnotation`, `deleteAnnotation` | `paperId`, `id` (annotation id) | the most plausible swap: both ids, same type, adjacent |
| `library/model/folderNavigation.ts::deriveBreadcrumb`, `formatFolderLabel`, `formatFolderPathLabel` | `root`, `path` | root dir and library path |
| `library/model/folderNavigation.ts::isUnderDir`, `deriveRelativeFolder` | `paperPath`, `dirPath` | |
| `import/citationMap/buildCitationMap.ts::paperWork` | `paperId`, `doi` | |
| `import/landing/pageFacts.ts::metadataOf` | `doi`, `arxivId` | |
| `import/flow/importNetworkInput.ts::importUrl` | `url`, `targetDir` | |
| `latex/build/createLatexBuildCommand.ts` and `createLatexPreviewCommand.ts` | `mainFile`, `outDir` | |
| `library/mutations/folderOps.ts::renameFolder` | `dir`, `newName` | |
| `library/mutations/import/paperImport.ts::importPdf` | `file`, `targetDir` | |
| `import/bibtex/BibtexService.ts::writePaperArtifacts` | `paperFolder`, `sourceFileName` | |

The list is a lower bound: it covers only parameters whose name names a concept. Parameters named `from`, `to`, `name`, `value`, `target` are not in `values` (not computed).

### 2.2 Call sites whose argument name suggests a different concept

Computed over 16,373 named arguments at resolved call sites, two passes: (a) `…Id` parameter receiving a different `…Id` argument, 26 sites; (b) path, url, id, key, dir or doi parameter receiving an argument named for another of those, 12 sites.

Pass (a), 26 sites, grouped: all are renames to a generic `id` parameter and none crosses concepts, except where noted.

| Site | Parameter <- argument | Verdict |
|---|---|---|
| `templates/host/publishHost.ts:75` | `ensurePublishableProject(id <- projectId)` | same concept |
| `helper/node/projects/createHelperProjects.ts:48-68` (5) | `projectOf(id <- projectId)` | same concept |
| `helper/parseHelperMessage.ts:32-43` (5) | `reject(id <- replyId)` | request/reply correlation id, same concept |
| `libraryUi/spaces/actions.ts:40-48` (5) | `store.createFolder`, `renameFolder`, `deleteFolder`, `addPapers`, `removePaper` `(id <- spaceId)` | the parameter `id` is the space id; folder and paper ids follow as other parameters. Judged correct; read only the names, not the stores |
| `libraryUi/dom/sidebar/spaces/renderSpaceRows.ts:48` | `acceptSpaceDrop(id <- spaceId)` | same concept |
| `spaces/store/mutation/glossaryMutation.ts:35` | `termFrom(id <- termId)` | same concept |
| `collab/comments/commentsFile.ts:61,66` | `editThread(id <- threadId)` | same concept |
| `activation/registerLibrarySidebar.ts:62`, `activation/registerPanelCommands.ts:113` | `showPaper(id <- paperId)`, `revealPaper(id <- paperId)` | same concept |
| `background/import/offerHandlers.ts:62,76` | `readOffer(id <- offerId)` | same concept |
| `libraryUi/store/libraryViewStore.ts:186` | `selectOnly(id <- toId)` | same concept (paper) |

Pass (b), 12 sites, all read and judged intentional:

| Site | Mismatch | Verdict |
|---|---|---|
| `templates/fileSystem/mineSource.ts:81` | `deriveTemplatePathProblem(path <- id)` | confirmed by reading: a template id becomes a folder name, so the id is checked as a path segment on purpose (comment above it says so). Not a bug; it is the exact place where a `TemplateId` constructor would absorb the check |
| `collab/deviceState/collabStore.ts:184` | `restore(docKey <- docPath)` | confirmed by reading: the doc key of a project file is its path. Intentional |
| `collab/deviceState/versionHistory.ts:18-22`, `collab/mirror/{mirrorContext,reconcileShareBlob,textMirror,untrackedFile}.ts` (9) | `Map.get/set(key <- path)` | maps keyed by project path. Same concept |

Result: no real swap bug found among resolved call sites. This is a negative finding: the current names are consistent enough that the checker's inability to tell concepts apart has not yet cost a defect. The gain of types is therefore prevention and readability, not repair. Limit: arguments that are not plain names (`f(a.b)` reports the last property; expressions are not covered) and unresolved calls through interfaces are not checked.

### 2.3 Self-explanatory signatures

| Measure | Count |
|---|---|
| Units with a primitive parameter whose bare name is `id`, `path`, `file`, `key`, `root` or `dir` (concept only in context) | 1,883 params and fields in `values` (id 716, path 368, file 264, root 240, key 221, dir 74; params and fields together, the split was not computed) |
| Units whose signature changes if the named concepts get types (parameters only, collections excluded) | paperId 317, absolute dir/root 326, file path 226, project-relative path 184, projectId 179, url 149, library-relative path 135, space ids 94, storage key 57, shareId 57, hash 48, doi 44 |
| Of which a type would replace an anonymous `string` where the name says nothing | bare `id` 96 unspecified plus the `paperId?`/`projectId?` judged rows (about 540) |
| Message and protocol fields (wire types) in `*protocol*`, `*messages*`, `*payload*` files | core 174, vscode 22, browser 31 |

The per-concept unit counts above sum to about 2,000 signatures; the sum double-counts units that carry two concepts (a `paperId` and a `doi`), so the true number of distinct signatures is lower (not computed). The first seven types of section 5 cover about 1,300 of that sum.

### 2.4 Current escapes: `any`, `unknown`, `as`

| Kind | core | vscode | browser | Total |
|---|---|---|---|---|
| `any` | 1 | 0 | 3 | 4 |
| `unknown` (as a type) | 721 | 133 | 191 | 1,045 |
| `as` | 481 | 54 | 88 | 623 |
| `as unknown as` | 17 | 0 | 4 | 21 |
| `x!` | 501 | 31 | 43 | 575 |
| `as const` | 126 | 17 | 20 | 163 |

`any` is almost absent. `unknown` is the project's chosen escape and appears for parsing untrusted input. By runtime (`as`/`unknown`): neutral 283/614, dom 202/201, node 75/95, vscode-host 36/102, worker 10/19, webview 13/14.

By domain (core, escapes `unknown`/`as`/`!`): libraryUi 78/85/76, collab 106/27/15, writing 78/54/109, reader 59/69/66, import 77/27/52, spaces 69/22/5, templates 62/26/12, relay 52/19/6, library 34/23/14, qmd 3/53/69. Browser: `storage` 37/19, `libraryUi` 24/13. Vscode: `writing` 46/9, `libraryUi` 21/23.

Top files (`any`/`unknown`/`as`): `libraryUi/store/libraryViewStore.ts` 0/17/12, `libraryUi/protocol/messageGuards.ts` 0/19/8, `storage/bridge/bridgeConnection.ts` (browser) 0/16/11, `libraryUi/sidebarMessages.ts` 0/5/19, `libraryUi/share/shareMessages.ts` 0/15/8, `qmd/editor/schema/qmdSchema.ts` 0/1/20, `templates/templateManifest/templateManifest.ts` 0/16/4, `templates/protocol/messageGuards.ts` 0/12/5, `reader/previewRequests.ts` 0/12/2, `qmd/editor/serializeBlocks.ts` 0/0/14, `libraryUi/store/prefs.ts` 0/9/5, `collab/storedShareKeys.ts` 0/12/2, `writing/checklist/checklistFile.ts` 0/10/3, `spaces/protocol/parseSpacesMessage.ts` 0/11/2.

What they are used for:

| Use | Evidence | Typing helps? |
|---|---|---|
| Message and protocol parsing | in files named `*protocol*`, `*messages*`, `*parse*`, `*Guard*`: 40 `as`/`as unknown as` and 94 `unknown`; top `as` targets: `m as SidebarToHost` (12), `value/raw as Record<string, unknown>` (28), `raw as { type?: unknown } \| null` (5) | partly: domain types turn `v is string` guards into `v is PaperId`, but the `as Record<string, unknown>` cast remains until a schema or shared parse helper replaces it |
| Storage / JSON / YAML reads | in `storage`, `*json*`, `*yaml*` files: 23 `as`, 68 `unknown` | partly: same as above |
| DOM events and nodes | `e.target as HTMLElement` (34), `as Node` (5), `as Element` (5); 226 `as` in `dom`/`webview`/`content-script` files | no: unrelated to domain types |
| Node errors | `error as NodeJS.ErrnoException` (31), `error as Error` (8) | no |
| Generics and `T` | `value as T` (4), `v as T` (4) | no |
| Narrowing of tagged data | `node.attrs.tex as string` (5; qmd/ProseMirror attributes) | no |
| Non-null `!` | 575; `libraryUi` 76, `writing` 109, `reader` 66, `qmd` 69 | no |

Judgment: of the 623 `as`, about 100 sit at message boundaries and would shrink with typed parse results; the DOM and Node-error casts (about 280 together) are independent of this work.

## 3. Cost

### 3.1 New types and where each concept lives

| Concept | New types | Proposed home | Representation |
|---|---|---|---|
| paperId (= cite key by contract) | `PaperId`; `CiteKey` either an alias of it or a separate brand | `core/model` (used by library, reader, libraryUi, import, ai, spaces and both apps) | brand of `string` |
| projectId | `ProjectId` | `core/writing/model` (or `core/model` if helper and templates import it) | brand |
| spaceId, folder/date/term ids | `SpaceId`, and either `SpaceFolderId`, `SpaceDateId`, `SpaceTermId` or one `SpaceItemId` | `core/spaces/model` | brand |
| shareId, relay token, hash | `ShareId`, `RelayToken`, `Sha256Hex` | `core/relay` or `core/collab` (shared by relay Worker and clients) | brand |
| tabId, libraryId | `TabId`, `LibraryId` | `browser/src/…` (browser only; libraryId used only in browser) | brand |
| Paths | `AbsolutePath`, `LibraryPath` (`papers/…`), `ProjectPath` (below a project folder), `RelativePath` (existing check) | `core/path` (shared module in the reorganization), `LibraryPath` next to `library/layout.ts` | brand; `AbsolutePath` is the only one that must agree with vscode `fsPath` and Node |
| URLs | `WebUrl` (http/https), `RelayUrl`; leave `vscode.Uri` as is | `core/url` | brand over `string` |
| Identifiers | `Doi`, `ArxivId`, `Pmcid`, `Pmid`, `OpenAlexWorkId` | `core/import/identifiers` (they are born there) | brand |
| Template id | `TemplateId` | `core/templates/model` | brand |

New types: about 22 in total, 8 of them cross-domain (`PaperId`, `AbsolutePath`, `LibraryPath`, `ProjectPath`, `WebUrl`, `Doi`, `ProjectId`, `ShareId`). Each brand is one declaration plus one constructor (see 3.3); a `Brand<T, Tag>` helper in `core/model` is a single extra type.

### 3.2 Signatures and fields to change

From section 2.3: parameters per concept (distinct units, primitive, non-collection) and fields (message and interface fields):

| Concept | Signatures (params) | Fields | Files | Message/protocol files |
|---|---|---|---|---|
| paperId (named + judged bare) | 317 | 135 | 174 | 12 |
| projectId | 179 | 84 | 108 | 8 |
| absolute dir/root | 326 | 88 | 205 | 2 |
| file path (all meanings, to be split) | 226 | 101 | 179 | 3 |
| project-relative path | 184 | 70 | 127 | 3 |
| library-relative path | 135 | 51 | 98 | 5 |
| url (web, relay, asset) | 149 | 87 | 127 | 8 |
| space ids | 94 | 54 | 33 | 3 |
| shareId | 57 | 32 | 52 | 0 |
| hash | 48 | 18 | 40 | 0 |
| doi | 44 | 22 | 39 | 2 |
| tabId | 28 | 12 | 21 | 1 |
| citeKey | 27 | 24 | 40 | 3 |
| storage key (`key`, judged) | 57 | 38 | 54 | 0 |

### 3.3 Construction points (where a value is validated or converted)

Most validators already exist; each returns `boolean` or `v is string` and would instead return the brand. This is the cheap half of the cost.

| Concept | Existing validator / producer | File |
|---|---|---|
| LibraryPath | `isLibraryPath` | `core/libraryUi/protocol/messageGuards.ts` |
| ProjectPath | `isProjectPath` (message guard), `isProjectPath` (allProjects parser), `isProjectPath` (history entry): three homonyms, max pair similarity 0.19 (different code, same name) | `libraryUi/protocol/messageGuards.ts`, `writing/allProjects/protocol/parseAllProjectsMessage.ts`, `writing/history/historyEntry.ts` |
| SafeSharePath | `isSafeSharePath` | `collab/model/safeSharePath.ts` |
| RelativePath | `checkRelativePath` | `library/relativePath.ts` |
| Helper project path / id | `assertProjectPath`, `isHelperProjectId` | `helper/node/projects/projectPaths.ts`, `helper/helperPaths.ts` |
| WebUrl | `isWebUrl` (two copies), `isHttpsUrl`, `parseHttpUrl`, `isSafeExternalUrl` | `libraryUi/protocol/messageGuards.ts`, `collab/invite/relayList.ts`, `import/pdfFinder/urlParts.ts`, `reader/protocol/webviewGuard.ts` |
| Doi | `extractDoi`, `normalizeDoiCandidate`, `isDoi` | `import/identifiers/doi.ts`, `messageGuards.ts` |
| ArxivId, Pmcid, Pmid | `normalizeArxivIdentifier`, `normalizePmcid`, `extractPmidFromUrl` | `import/identifiers/` |
| OpenAlexWorkId | `isWorkId` (`/^W\d+$/`) | `libraryUi/protocol/messageGuards.ts` |
| PaperId | folder name on scan; id generator on import; `isId` (non-empty string only, no format check) | `library/scan`, `library/paper/citeKey.ts`, `messageGuards.ts` |
| ShareId, RelayToken, Sha256Hex | `isShareId`, `isRelayToken`, `isSha256Hex` | `relay/http/bodyFields.ts` |
| Item id (qmd) | `isItemId` | `qmd/items/itemId.ts` |
| Folder hash | `isFolderHash`, `parseFolderHash` | `libraryUi/editorArea/workspaceHash.ts`, `libraryUi/folderHash.ts` |

Without a validator today: `PaperId` format (the contract defines `authorYearWord` but `isId` only checks non-empty, and disk folders can hold any name), `ProjectId`, `SpaceId`, `TabId`, `LibraryId`, `AbsolutePath`. For these the constructor is new: either a trivial cast `asPaperId(s)` at the one place the value is born (scan, generator) or a real check.

### 3.4 Serialization boundaries and cross-package boundaries

Branded types are erased at runtime, so serialization never changes the wire format. The cost is in the re-validation after decode: every place that reads untrusted JSON must call the constructor, or the brand is a lie.

| Boundary | Where | Concepts crossing | Effort |
|---|---|---|---|
| Library UI host protocol (`UiToHost`/`HostToUi`) | `core/libraryUi/protocol/messages.ts`, `messageGuards.ts`, `payloads.ts`; `SHAPES` table already maps field to check | PaperId, LibraryPath, ProjectPath, WebUrl, Doi, WorkId | S: change each `FieldCheck` to return the brand; `parseUiMessage` ends in `raw as UiToHost` (one cast stays unless the table is typed) |
| Sidebar, share, spaces, allProjects, search, templates, details protocols | `libraryUi/sidebarMessages.ts`, `shareMessages.ts`, `spaces/protocol/parseSpacesMessage.ts`, `writing/allProjects/protocol/parseAllProjectsMessage.ts`, `writing/search/protocol/parseSearchMessage.ts`, `templates/protocol/messageGuards.ts` | ids, paths | M: seven near-duplicate parser files with their own `isText`/`isId` (`isText` has 10 copies, max similarity 1.0) |
| Reader protocol | `core/reader/protocol/*`, `previewProtocol.ts`, `previewRequests.ts`, `webviewGuard.ts` | PaperId, build roots, WebUrl | M |
| Browser runtime messages | `browser/src/platform/messages` (`captureMessages.ts`, `libraryMessages.ts`, `runtimeMessage.ts`) | PaperId, WebUrl, TabId, LibraryPath | M |
| Helper socket | `core/helper` (`parseHelperMessage.ts`, `helperPaths.ts`); [contracts/helper](../documents/contracts/helper.md) | ProjectId, ProjectPath | S |
| Relay HTTP | `relay/http/bodyFields.ts`, `relay/worker/answerRelayRequest.ts` | ShareId, RelayToken, Sha256Hex, path | S (validators exist), but the Worker is bundled alone: brands must be declared in files it already imports |
| IndexedDB / browser storage | `browser/src/storage` (`idbFileSystem.ts`, `folderTreeStore.ts`, `libraryIdentity.ts`, `tabLease.ts`, `paperRecordStore.ts`, `bridge/bridgeConnection.ts` with 16 `unknown` + 11 `as`) | LibraryPath, PaperId, LibraryId | M: keys leave and re-enter the DB as `string`; the store becomes the constructor |
| Device state, JSON files | `collab/deviceState`, `collab/storedShareKeys.ts`, `libraryUi/store/prefs.ts`, `writing/checklist/checklistFile.ts` | DocKey, ShareId, ProjectPath | S to M |
| `metadata.yaml` / `labshelf.yaml` / `space.json` | `library/paperMetadata.ts`, `library/writeRecords`, `spaces/store/readSpace.ts`, `templates/templateManifest/templateManifest.ts` | Doi, ArxivId, CiteKey, SpaceId | M: record parse is the construction point for Doi and CiteKey; invalid values currently pass through as strings |
| URLs | `labshelf:` links ([contracts/links](../documents/contracts/links.md)), `location.hash` in `workspaceHash.ts`, share links | CiteKey, FolderPath | S |
| Cross-package | core exports vscode and browser consume: 48 named `paperId` values in vscode, 31 in browser; `LibraryPaths` in `vscode/src/libraryUi/createLibraryPaths.ts` | PaperId, AbsolutePath, LibraryPath | each core brand must be exported from the domain barrel before the apps change; apps then change in the same step as the core signature (no half-typed API) |

### 3.5 S / M / L estimate per concept

Measure: S under about 40 signatures and one package, M up to about 200 or two boundaries, L above that or a new validator, three packages.

| Concept | Size | Reason |
|---|---|---|
| `Doi` | S | 44 params, validators exist in `import/identifiers/doi.ts`, mostly in `import` |
| `ArxivId`, `Pmcid`, `Pmid`, `OpenAlexWorkId` | S | around 14 each, single domain |
| `ShareId`, `RelayToken`, `Sha256Hex` | S | validators in `relay/http/bodyFields.ts`; 57+ params |
| `ProjectId` | M | 179 params, helper and writing validate separately; folder name born on disk |
| `LibraryPath` | M | 135 params, one guard, but libraryUi, library, browser storage |
| `ProjectPath` | M | 184 params, three homonym guards; collab/writing/latex/typst |
| `WebUrl` | M | 149 params; guards in four places; `URL` objects already used in places |
| `CiteKey` / `PaperId` | L | 317 + 135 fields + 395 bare ids, all three packages, every wire format, folder names on disk |
| `AbsolutePath` (+ `rootDir`) | L | 326 + 226 params, `node:path`, `vscode.Uri.fsPath`, config, every `node/` folder; `path.join` returns `string` so each join needs a typed wrapper (`Join<T>` already generic) |
| Space ids | M | 94 params in `spaces/`, protocol and sidebar |
| `TabId`, `LibraryId` | S | browser only |
| Storage keys (`key`) | L | meaning is mixed; not a single concept (split first) |

## 4. Duplicate-type risk

### 4.1 Structurally equal types in different places (`types.shape_hash`)

22 shape groups (50 types), at least 3 members, in 2+ files. Groups relevant to domain types:

| Group | Types | Risk |
|---|---|---|
| Rectangle | `AnnotationPosition` (`model/annotation.ts`), `PageBox` (`writing/versions/derivePageBlocks.ts`), `Rect` (`reader/hoverCrop.ts`) | independent; not a domain-type issue |
| Paper metadata | `ResolvedMetadata` (`import/metadata/resolvedMetadata.ts`) = `PaperRecordMetadata` (`library/mutations/import/importedPaperRecord.ts`); both about 0.93 similar to `BibliographicFields` (`model/bibliographicFields.ts`), `RegistryEntry` | a branded `Doi` or `CiteKey` field would have to change in four places; unify first |
| Session | `ProjectSession` (`writing/session/projectSession.ts`) = `SidebarSession` (`libraryUi/sidebar/sidebarProjects.ts`) | a `ProjectId` field would be duplicated |
| Text layer | `TextLayerJobView` (`libraryUi/protocol/payloads.ts`) = `TextLayerJob` (`command/textLayerQueue.ts`, app side) | carries `paperId`; wire and domain copy |
| Invites | `Invite` (`collab/invite/invite.ts`) = `StoredInvite` (`collab/share/flows/sharePorts.ts`) | carries `shareId`, relay URL |
| Mirrors | `ProjectMirror`, `ConnectionMirror`, `BrowserProjectMirror` | carry project paths |
| Citation | `CiteKeyMetadata` (`library/paper/citeKey.ts`) = `WorkReference` (`import/paper/samePaper.ts`) | carries doi, cite key |
| Preview | `PreviewBuildState` in `reader/dom/preview/footer/buildStateText.ts` and `writing/preview/previewFrame.ts` | duplicated by file |
| Dependencies | `CachedCatalogIndexDeps`, `CachedThumbnailDeps`, `CommunitySourceDeps`, `UniverseSourceDeps` | none |

Near-equal pairs (typed similarity ≥ 0.9, `type_pairs`): `BibliographicFields` ~ `ResolvedMetadata`, `PaperRecordMetadata`, `RegistryEntry` (0.87 to 0.93); `PaneState` ~ `Pane` (0.93); `ProjectTreeMessage` ~ `ProjectTreeRequest` (0.88); `PaperRecord` ~ `ListPaper` (0.86).

### 4.2 Concepts that already have more than one type or validator

| Concept | Duplication |
|---|---|
| PaperId and CiteKey | one string by contract, two names (`paperId`, `citeKey`/`key`); `CiteKeyMetadata` and `WorkReference` are equal shapes |
| ProjectPath | three `isProjectPath` guards with different code (similarity 0.19) plus `assertProjectPath`, `isSafeSharePath`, `checkRelativePath`: five definitions of "a safe relative path" |
| WebUrl | two `isWebUrl` (similarity 0.28), `isHttpsUrl`, `parseHttpUrl`, `isSafeExternalUrl`; `hostOf` has four copies (browser and core, `identical-subset`) |
| `isText`, `isId` | 10 copies of `isText` in protocol parsers (identical shape) |
| `isInside` | three copies with different semantics across core and vscode (path containment; a typed `AbsolutePath` would force a choice) |
| `normalizeInputPath` | two copies in `writing` (`figures/inputPattern.ts`, `synctex/normalizeInputPath.ts`), different code |
| Ids of the peer kind | `PeerId` is a plain alias in `collab/transport/peerTransport.ts`, so it carries no safety |

### 4.3 What `core/model` holds today and where new types go

`core/src/model` holds 9 files: paper record, bibliographic fields, venue, text layer, annotation, PDF theme, PDF version, log entry. Its role in [architecture](../documents/architecture.md#core): "shared types and their runtime value lists". It has no identifiers.

Placement rule that avoids duplicates:

| Rule | Examples |
|---|---|
| Cross-domain ids and paths go to a shared module, in the reorganization's shared modules | `PaperId`, `CiteKey`, `ProjectId` in `core/model`; `AbsolutePath`, `LibraryPath`, `ProjectPath`, `RelativePath` in `core/path`; `WebUrl` in `core/url` |
| A type used by one domain stays in that domain's `model` | `SpaceId` in `spaces/model`, `ShareId` and `RelayToken` in `relay` (Worker-safe), `Doi`/`ArxivId` next to their parser in `import/identifiers` |
| A brand and its only constructor live in the same file | `isLibraryPath` moves next to `LibraryPath` and returns it |
| Apps never declare a brand | browser-only `TabId`/`LibraryId` are the exception; they may live in the browser package because no other package sees them |
| Protocol types import the brand, never redefine it | `libraryUi/protocol`, `spaces/protocol`, `browser/src/platform/messages` import from core |
| Before adding a brand, merge duplicated record types that carry it | `ResolvedMetadata`/`PaperRecordMetadata`, `ProjectSession`/`SidebarSession`, `Invite`/`StoredInvite` |

## 5. Final ranking

Gain: H high, M medium, L low. Cost: S, M, L as in 3.5. Priority: P1 first batch, P2 second, P3 later, skip.

| Concept | Gain | Cost | Risk | Priority |
|---|---|---|---|---|
| `LibraryPath` | H: 135 params, a strict guard exists, mixed with project paths and absolute dirs | M | low: guard exists; a `papers/…` brand must not leak into `RelativePath` | P1 |
| `ProjectPath` (project-relative) | H: 184 params, three homonym guards, collab/writing/helper | M | low; unify guards before typing | P1 |
| `AbsolutePath` + library/project root | H: 326 dir/root + 226 path params, roots vs files vs dirs mixed in 160 swap units | L | high: `node:path`, `fsPath`, `Uri`, Windows; needs typed `join` | P2 (start at the layout seam, `LibraryLayout<T>`) |
| `PaperId` (= cite key) | H: 550+ values, all packages, plus the `updateAnnotation(paperId, id)` pair | L | high: folder names on disk are not validated; many bare `id`; wire formats | P2 (brand first in core signatures, apps follow) |
| `ProjectId` | H: 322 values, helper + writing + browser | M | medium: two validators; folder name born on disk | P1 |
| `Doi` | M: 69 values, 44 params, swapped with `arxivId`/`paperId` in a few places | S | low: constructor exists; invalid DOIs in old `metadata.yaml` must still load (decide: brand only after normalization) | P1 |
| `WebUrl` | M: 214 values; 149 params | M | low to medium: `URL` objects and strings mixed | P2 |
| `ShareId` / `RelayToken` / `Sha256Hex` | M: 90+42+69; tied to the security boundary; validators exist | S | low; Worker bundle must not import app code | P1 |
| `ArxivId`, `Pmcid`, `Pmid`, `OpenAlexWorkId` | L to M | S | low | P3 (with `import/identifiers`) |
| Space ids (`SpaceId`, item ids) | M: 144 values in one domain | M | low | P2 (with the spaces module) |
| `TemplateId` | L: 2 named values | S | low | P3 |
| `TabId`, `LibraryId` | L to M: 57 values, browser only | S | low | P3 |
| `DocKey` | L: 39 values, equal to the project path by design | S | none | skip (alias of `ProjectPath`) |
| Storage `key` (bare) | M but undefined: 132+59 mixed | L | high: no single concept | skip; split by meaning first |
| Bare `id` of unspecified concept | M: 96 | S | n/a | fix by renaming to the owning concept when a type lands |

### 5.1 Recommended first types (7)

1. `LibraryPath`. The guard, `isLibraryPath`, is already the single point where the UI protocol validates `papers/…` paths. Highest density of swap risk with roots and project paths (`deriveBreadcrumb(root, path)`, `formatFolderLabel(root, path)`).
2. `ProjectPath`. Three homonym guards plus `assertProjectPath`, `isSafeSharePath` and `checkRelativePath` are five definitions of nearly one idea; typing forces one definition.
3. `ProjectId`. 322 values, validated in two places; appears in `version(projectId, relativePath, hash)` and `remember(requestId, projectId, path)`.
4. `Doi`. Smallest change with a real constructor (`normalizeDoiCandidate`); stops `metadataOf(doi, arxivId)` and `paperWork(paperId, doi)` from being swappable.
5. `ShareId`, `RelayToken`, `Sha256Hex`. The relay boundary is a trust boundary; validators already exist as `value is string`; three types, one file.
6. `PaperId` in core signatures only (library, reader, libraryUi, import), exported from `core/model`, with apps following in a later step. Start with `paperSidecarStore.updateAnnotation/deleteAnnotation` where `paperId` and annotation `id` are adjacent strings.
7. `AbsolutePath` at the layout seam only (`LibraryLayout<AbsolutePath>`, library root, project root), not yet every `string` in `node/` code.

Also: one `WebUrl` guard replaces two `isWebUrl`, `isHttpsUrl` and `isSafeExternalUrl`; do it with the `core/url` module.

## 6. Relation with the reorganization

The reorganization proposal starts with shared modules (`core/path`, `core/url`, …) and then domain modules (library, import, reader, libraryUi, writing, collab, templates, spaces, …). I could not read it; this maps typing onto those names.

| Typing work | Do together with | Reason | Can wait |
|---|---|---|---|
| `AbsolutePath`, `LibraryPath`, `ProjectPath`, `RelativePath` | creation of `core/path` | the five path validators and `isInside`/`normalizeInputPath` homonyms must be merged in the same step; moving them and typing them is one edit per call site | typing every `string` path in `node/` folders after the module exists |
| `WebUrl`, `RelayUrl` | `core/url` | `hostOf` (4 copies), two `isWebUrl`, `isHttpsUrl`, `parseHttpUrl` merge in the same session | `URL` object adoption |
| `Doi`, `ArxivId`, `Pmcid`, `Pmid`, `OpenAlexWorkId` | the `import` module (`import/identifiers`) | brands belong beside their parsers; one file each | later: typing the registries' result records (after `ResolvedMetadata`/`PaperRecordMetadata` merge) |
| `PaperId`, `CiteKey` | the `library` module (identity) and `core/model` | folder-name rules and the id generator are in `library`; the merge of `CiteKeyMetadata`/`WorkReference` and of the metadata records is a reorganization topic | typing `reader`, `libraryUi` and app signatures: later, domain by domain |
| `ProjectId` | the `writing` module and `helper` | `helper/helperPaths.ts::isHelperProjectId` and the writing validator merge | the browser and vscode signatures |
| `ShareId`, `RelayToken`, `Sha256Hex` | `collab`/`relay` module | validators in `relay/http/bodyFields.ts` move with `relay` | |
| `SpaceId` and item ids | the `spaces` module | one domain, one protocol | |
| Protocol parsers (`libraryUi`, `spaces`, `writing/allProjects`, `templates`, `reader`, `browser/src/platform/messages`) | `libraryUi`/`spaces` module work, with a shared `parse` helper replacing 10 `isText` copies | the parse step is the construction point; once a helper returns typed fields the `as Record<string, unknown>` casts go | schema-based parsing |
| Browser `TabId`, `LibraryId`, IndexedDB keys | browser storage restructure | local to the package | any time |
| Equal-shape record types (`ProjectSession`/`SidebarSession`, `Invite`/`StoredInvite`, `ResolvedMetadata`/`PaperRecordMetadata`) | reorganization (merge) | typing a field in two copies doubles the work | |
| `any`/`as` clean-up (DOM, Node errors, `!`) | not related | | later |

Ordering that keeps each step small: (1) shared modules with their brands and constructors, without changing callers; (2) protocol guards return the brands; (3) core domain signatures, one domain per change; (4) vscode and browser consumers in the same change as the core signature they call. A brand without a constructor at the boundary does not earn its keep, so the constructor and the first guard that returns it go together.

## 7. Method and limits

Computed:
- `values`, `params`, `units`, `calls`, `args`, `types`, `type_pairs`, `type_escapes`, `homonyms` queries; all counts and lists in sections 1.1 to 1.3, 2.1 (swap risk), 2.2 (mismatch passes), 2.4 (escapes), 3.2, 3.3, 4.1.
- `analysis/scripts/typing.mjs` adds the table `value_concepts` (fine concept, basis `name` or `domain`, collection flag) to `labshelf.db`; `analysis/scripts/typingReport.mjs` prints the aggregates.

Judged:
- Fine concept of bare names (`id`, `path`, `file`, `key`, `root`, `url`): the domain folder decides (for example libraryUi `id` is a paper id because the `paper.*` messages use `id`). Spot-checked in `libraryUi/protocol/messages.ts`; not verified for every row. Rows with a `?` in the script output are judged; they are the counts for bare ids and bare paths.
- Absolute, library-relative, project-relative and browser virtual paths share the same name; the split is by package and domain.
- Cost sizes (S/M/L) and the first-type list.
- The statement that no swap bug exists rests on two name-level passes over resolved call sites and on reading two candidates (`mineSource.ts:81`, `collabStore.ts:184`); both are intentional.

Limits:
- `values` only covers names that end in a concept suffix; parameters named `from`, `to`, `target`, `name`, `value`, `text`, `label` are not in the swap-risk list.
- `args` records only arguments that are plain names, and only calls that resolve to a product unit; calls through interfaces (ports, host objects) and expressions are missing. 16,373 named arguments were checked.
- Signature counts overlap between concepts (a unit with a `paperId` and a `doi` counts under both).
- Counts exclude tests, `__tests__` and `*.test.ts`. Escape counts include every file under `src/`, and `unknown`/`as` in tests are not counted.
- The type shape tables (`types`) record 50 types in 22 groups; some are coincidental shapes (rectangles), listed only when they carry a concept.
- The estimate of "about 100 `as` at message boundaries" comes from filename globs (`*protocol*`, `*messages*`, `*parse*`, `*Guard*`): 40 `as` plus part of the 94 `unknown`; it is not an exact count.
- No performance, bundle-size or build-time effect was measured; branded types are compile-time only.
