sha: 080f74b
files: documents/plans/writing-*/plan.md, documents/contracts/library-format.md, documents/contracts/sync.md, packages/core/src/writing/project/node/projectCatalog.ts, packages/vscode/src/writing/projectCommands.ts
source: Explore scout, 2026-10-16

# Overlap with active writing plans

- writing-project-workspace: session 3 of 8 (sessions 1-2 done). Nothing touches createProject, templates.ts or `.research/`. Out still lists "template gallery". S6.2 adds `.labshelf/checklist.json` to library-format.md. Gallery UI waits for its session 6.
- writing-2-writing-sync: S2 adds `.research/sync/base/` to the layout block of library-format.md (merge risk on the same block); do not add a Drive namespace while it edits sync.md.
- writing-2-submission-tools owns figures/values/check, .labshelf/versions/, .labshelf/rebuttal/; writing-2-research-links owns papers:, .labshelf/state.json. Save as template excludes them.
- core-no-pills, typst-source-sync: no overlap.

# Current creation
- createProject(libraryRoot, {title, format}, logger) at core/src/writing/project/node/projectCatalog.ts:47-63: claim id, projectTemplate (:54), mkdir, write main, labshelf.yaml, log "project created". Port: projectData/projectDataPort.ts:16, impl projectData/node/nodeProjectData.ts:18. Only app caller vscode/src/writing/projectCommands.ts:31 (title box, pickFormat, create, reload, open).
- Tests: core/__tests__/writing/project/node/projectCatalog.test.ts, projectData/node/nodeProjectData.test.ts, vscode/__tests__/writing/projectCommands.test.ts:32-48.

# Contracts
- library-format.md#layout (lines 10-30) has no templates/, .research/templates/ or .research/staging/.
- sync.md#namespaces-on-drive: library, appdata, projects.
