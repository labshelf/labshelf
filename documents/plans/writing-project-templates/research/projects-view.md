sha: 632d371
files: packages/core/src/writing/project/**, packages/core/src/writing/projectData/**, packages/core/src/writing/templates/**, packages/vscode/src/writing/projectCommands.ts
source: Explore scout, 2026-10-16

# Project creation and templates in core

- core/src/writing/project/node/projectCatalog.ts:47-62 `createProject(libraryRoot,{title,format},logger)` (file 97 lines): claimProjectId (:38-44, private; INVARIANT ids unique across library and registry) → blankTemplate(format,title) → mkdir projects root → non-recursive mkdir folder → writeFileAtomic main → writeFileAtomic labshelf.yaml last via serializeProjectFile({id,format,main}) (no engine) → log INFO "project" "project created" {folder,format} → readProject(folder,"library",logger). No staging: a failure leaves a yaml-less folder.
- core/src/writing/templates/blankTemplates.ts:54 `blankTemplate(format,title): {main,text}`; only caller projectCatalog.ts:11. `core/src/writing/project/templates.ts` no longer exists.
- Reuse: templatePaths.ts:16 `templatePathProblem(path)`, :31 `templateTreeProblem(files:{path,size}[])` (return reason|undefined; tree refuses labshelf.yaml, >500 files, >5 MiB/file, >20 MiB total, case-insensitive dupes). sources/templateSource.ts:7 `TemplateFile {path, bytes: Uint8Array}`. library/node/atomicWrite.ts:9 `writeFileAtomic(target, string|Uint8Array, tmpDir?)` mkdirs parents. project/projectFile.ts:83 `serializeProjectFile`, :14-31 ProjectSettings (id, format, main?, engine?, bibliography?, typst?, papers?).
- templateManifest.ts:44-50 TemplateManifest has format, engine (LATEX_ENGINES + "typst"), main (relative to files/); :115 parseTemplateManifest; no manifest serializer exists.
- node/mineSource.ts:30-75 reads `<library>/templates/<id>/template.yaml` + `files/**`, drops id≠folder; node/readTemplateTree.ts:32 lstat walk refusing symlinks/hard links.
- Port: projectData/projectDataPort.ts:16 `createProject(libraryRoot,{title,format})`; node impl projectData/node/nodeProjectData.ts:7,18; exported from project/node/index.ts:2. Only vscode calls it: vscode/src/writing/projectCommands.ts:23-35 (input box, LaTeX/Typst quick pick, createProject, reload, OPEN_PROJECT_COMMAND).
- Tests: core/__tests__/writing/project/node/projectCatalog.test.ts:29-125; core/__tests__/writing/projectData/node/nodeProjectData.test.ts:21-39; vscode/__tests__/writing/projectCommands.test.ts:32-48; vscode/__tests__/support/writingFixtures.ts:21 stub.
- Dir counts: templates/ root 7 sources, templates/node 4, project/node 7 (limit 8).
- fs.rename onto an existing empty dir succeeds on POSIX: check the target first.
