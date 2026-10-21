sha: (plan draft, 2026-10-20)
files: packages/core/src/{library,writing,library-ui,details,ui}
source: two Explore scouts at plan time

# Core facts the briefs rely on

## Core library
- Paper: `model/paperRecord.ts:9-40` (`PaperRecord`: id = folder name = cite key, title, status, …). Status: `model/paperStatus.ts:1-17` (`PAPER_STATUSES`, `STATUS_LABEL`).
- Snapshot store: `library/model/libraryStore.ts:1-80` (`snapshot`, `onChange(listener) → unsubscribe`, coalesced `reload()`, `paper(id)`). Types: `library/model/types.ts:4-44`.
- Mutations over an injected context: `library/mutations/context.ts:19-30` (`MutationContext`: `fs: LibraryFileSystem`, `paths`, `logger`, `now?`), example `library/mutations/folderOps.ts`.
- Layout constants: `library/layout.ts:1-50` (`PAPERS_DIR`, `PROJECTS_DIR`, `libraryLayout(root, join)`).
- Storage port: `ports/libraryFileSystem.ts` (`LibraryFileSystem`: readText, writeText atomic, exists, mkdir, rename, trash, removeTree). Implementations: `library/node/nodeLibraryFileSystem.ts`, `packages/vscode/src/storage/vscodeFileSystem.ts`, `packages/browser/src/storage/libraryFileSystem.ts` (IndexedDB or bridge; empty folder = `.keep`).
- JSON file that keeps unknown keys, pure parse/serialize: `writing/checklist/checklistFile.ts:5-100`.
- Conflict copies: `library/conflicts/conflictCopy.ts` (`ConflictOwner` = paper | project, `conflictResolutions`), `library/conflicts/node/conflictScan.ts`, `writing/merge/node/libraryConflictScan.ts` (whole-library scan).

## Core projects
- `writing/allProjects/projectLibraryPort.ts` (`ProjectLibraryPort`: list, onDidChange, open, …), `projectRow.ts` (`ProjectRow.id` is the host key: a folder path in VS Code, the project id in the browser), `library/projectLibrary.ts` (core implementation the apps feed), `deadlineText.ts`.
- Project id: `writing/project/writes/claimProjectId.ts`; settings `writing/project/projectFile.ts` (`target: {venue, deadline}`).
- Checklist: `writing/checklist/{checklistFile,buildChecklist,readChecklistSignals}.ts` (done / total per project).

## Core UI
- Sidebar: `library-ui/dom/sidebar/` already holds 8 source files (new code goes in a subfolder). `sidebarSections.ts:6-9`: closed unions `SectionId = "library" | "projects"`, `GroupId`. `mountLibrarySidebar.ts:1-155` takes optional `projects?: SidebarProjectActions` (opt-in pattern). Rows: `sidebarRows.ts`, view `sidebarView.ts`, tree helpers `library-ui/dom/list/treeNav/`.
- Editor area: `library-ui/dom/editorArea/mountEditorArea.ts`, `styles/editor-area.css`. Tab strip inside a pane: `details/dom/tabStrip.ts`.
- Widgets: `ui/dom/widgets/{menu,dialog,quickInput,toast,overlay,arcMark}.ts`; `el` in `ui/dom/dom.ts`; icons `ui/icons/glyphs.ts` (has layers, target, check, message, note, link, plus, edit, trash, download, search; lacks share, calendar, users).
- Tokens: `ui/tokens/*.ts`, generated `ui/dom/tokens.css` (`pnpm --filter @labshelf/core tokens`).
- Page pattern to copy (protocol + server + mount in core, app gives a port): `writing/allProjects/{protocol/messages.ts, protocol/parseAllProjectsMessage.ts, serveAllProjects.ts, dom/mountAllProjects.ts}`; transport `library-ui/protocol/transport.ts:6-10` (`MessageEnd`), loopback `createLoopbackTransport`.
- Tests: jest + ts-jest ESM; DOM tests start with `/** @jest-environment jsdom */`; mirror `packages/core/__tests__/…`; examples `__tests__/writing/allProjects/serveAllProjects.test.ts`, `__tests__/details/dom/mountDetails.test.ts`.

