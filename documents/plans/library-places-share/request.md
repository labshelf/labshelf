# Request: one place-tab header for Library, All projects and All Spaces, with Share

Written for the orchestrator of the next session. Decisions below were made by the user on 2026-11-02.

## What the user asked
- The three list pages (Library, All projects, All Spaces) use the same header: the shared widget `packages/core/src/ui/dom/widgets/placeHeader.ts` (`mountPlaceHeader`), already used by All projects and All Spaces (plan `spaces-places`, uncommitted on branch `refactor/deck-workspace`).
- Library places: "All papers N" and "Trash N". No Archived.
- Every header gets a ghost "Share" button that shares the selected item, disabled when nothing is selected.
  - Library is the exception: Share opens a menu with "Share folder" (the current folder, existing `runShareFolderDialog`) and "Share selected paper" (disabled without a selected paper).
  - All projects: shares the selected project (`runShareProjectDialog(host, id)`, selection in `mountAllProjects.ts` `s.selected`).
  - All Spaces: shares the selected Space. The catalog has no selection yet.

## What exists (scout, sha f2f73527)
- Papers have no in-app trash: deleting goes to the OS trash (`library/mutations/paperMutations.ts` l.97-112, `library/node/fileSystem.ts` l.152). A Trash place needs a trashed marker on the paper record, restore, delete forever and empty trash, in both hosts, and the list model (`libraryUi/listModel.ts` deriveScope, store in `libraryUi/store`) must filter by place.
- The Library header is bespoke (`libraryUi/dom/libraryChrome.ts` l.158-240: sidebar toggle, search, Add, folder Share button `mountShareFolderButton`). The Library page title already shows the folder path (`renderPageHeading` + breadcrumb in the heading).
- Papers cannot be shared: ShareHost has only `shareableFolder` / `shareFolder` (`packages/core/src/share`).
- Spaces have no sharing: only a planned stub button in `spaces/dom/mountSpace.ts` l.30-31.
- Tests pinning the headers: `__tests__/ui/dom/widgets/placeHeader.test.ts`, `__tests__/libraryUi/dom/libraryChrome.test.ts` (folder share l.154-180), `__tests__/writing/allProjects/dom/allProjectsHeader.test.ts`, `mountAllProjects.test.ts`, `__tests__/spaces/dom/catalog/mountSpacesCatalog.test.ts`.

## Suggested sessions
1. Library header on `mountPlaceHeader` with only "All papers" (no behaviour change), plus the Share button on all three pages: folder share in Library, project share in All projects; "Share selected paper" and the Spaces Share disabled with a "coming soon" title.
2. Paper Trash (contract: on-disk marker in the paper record, both hosts, list model, restore/delete forever/empty trash, Trash tab).
3. Paper sharing (contract: share format and ShareHost method; design fork for the user).
4. Space selection in the catalog and Space sharing (contract; largest; design fork for the user).
