sha: (plan draft, 2026-10-20)
files: packages/core/src/library/mutations/, packages/core/src/library/model/libraryStore.ts
source: plan decisions D1, D3

# Space store API (decided)

folder `packages/core/src/spaces/store/`. A `SpaceStore` built with `{ root, fs, paths, logger, now? }` exposes `list()`, `read(id)`, `reload()`, `onChange(listener) → unsubscribe`. Mutations, each a read-modify-write of one file that re-reads just before writing: `createSpace(name)`, `renameSpace`, `setPurpose`, `deleteSpace` (trash), `addPapers(spaceId, paperIds, folder?)`, `removePaper`, `setFocus`, `createFolder`, `renameFolder`, `deleteFolder` (references and child folders move to the parent), `moveReference`, `linkProject`, `unlinkProject`, `addDate`, `updateDate`, `removeDate`, `setDone`, `addTerm`, `updateTerm`, `removeTerm`. Every mutation logs at INFO with the space id; every failure logs at ERROR with the path and rethrows with context. A read-only Space (version above 1) rejects mutations with a typed error. Listing skips hidden entries and folders without `space.json`.
