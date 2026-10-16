sha: fc9a469
files: packages/core/src/writing/templates/**, packages/core/src/writing/project/node/projectCatalog.ts, packages/core/src/writing/projectData/projectDataPort.ts, packages/core/src/writing/typst/node/typstPackages.ts, packages/core/src/writing/latex/toolchain/node/findExecutable.ts, packages/vscode/src/writing/projectCommands.ts, packages/vscode/src/writing/session/**, packages/vscode/src/writing/build/toolchain/**, packages/vscode/src/activation/registration/registerWritingView.ts, packages/vscode/package.json
source: Explore scout, 2026-10-16 (session 3 re-scout)

# Templates API, install, New project, engines, Projects view

Paths under packages/; T = core/src/writing/templates.

## Templates (core)
- T/templateEntry.ts:5-12 `TEMPLATE_SOURCES = ["community","universe","mine"]`; `TemplateEntry extends TemplateManifest { source; version? }`. No thumbnail, sample or file-list field.
- T/templateManifest.ts:9-28 `TemplateManifest {id,name,description,category,format,engine,main,compiler?,license,authors}`; `ProjectTemplate`; `parseTemplateManifest` (never throws); `serializeTemplateManifest`.
- T/sources/templateSource.ts:13-19 `TemplateSource {id; list(signal?): Promise<TemplateEntry[]>; files(entry, signal?): Promise<TemplateFile[]>}`; `TemplateFile {path; bytes}`; `FetchLike`; `TemplateCache {readIndex, writeIndex}`.
- T/sources/communitySource.ts:49 `createCommunitySource({fetch,cache,logger})`. Index at jsDelivr `@main/index.json`; files at `@<commit>/templates/<id>/files/<path>`, size and sha256 checked ("The catalog is updating, try again later"). `toGalleryEntry` (:27) drops the index's `thumbnail`, `sample` and `files[]`.
- T/node/universeSource.ts:31 `createUniverseSource({fetch,cache,logger,packages:{download},packageCacheDir})`; `packages` = `TypstPackageStore` (core/src/writing/typst/node/typstPackages.ts:46, download :69), cache dir from `typstPackageDirs().cache` (:24). `files()` downloads the package when missing. `UniverseTemplate` (T/sources/universeIndex.ts:11) not checked for thumbnail fields.
- T/node/mineSource.ts:30 `createMineSource({libraryRoot,logger})`; [] when the folder is missing; bad manifests logged and skipped.
- Offline: T/sources/fetchCachedIndex.ts:47-61 returns the cached body on fetch failure (WARN, `fromCache:true`), but `list()` drops the flag. No cache: ERROR and throws `Could not load the template index from <url> (...)`.
- T/node/fsTemplateCache.ts:18 `createFsTemplateCache(libraryRoot)`; index.json + index.etag only. The contract's `thumbnails/` cache (templates.md#cache) is not implemented.
- T/filterTemplates.ts:7-33 `filterTemplates(entries, {source?, formats?, category?, query?})`; folded query over id, name, description, authors.
- T/blankTemplates.ts:56 `blankTemplate(format,title): {template, files}`.
- T/node/saveProjectAsTemplate.ts:84 `saveProjectAsTemplate(libraryRoot, projectId, {name,category,license,description,authors,engine?}, logger): Promise<TemplateManifest>`; errors wrapped `saving project "<id>" as a template failed: <cause>`.
- T/licenseExpression.ts:47 `isLicenseExpression` (not in the T barrel).
- T/templatePaths.ts:16,31 `templatePathProblem`, `templateTreeProblem`.

## Install
- core/src/writing/project/node/projectCatalog.ts:70-102 `createProjectFromTemplate(libraryRoot, {title, template, files}, logger): Promise<ProjectEntry>`; checks paths and main, stages in `.research/staging/<id>/`, renames into `projects/<id>/`, labshelf.yaml last; on failure removes staging and throws `creating project from template <id> failed while <step>`. Port: projectData/projectDataPort.ts:17.

## VS Code
- vscode/src/writing/projectCommands.ts:23-35 `newProject`: input box (title) → `pickFormat` (:15, to delete) → `projects.data.createProjectFromTemplate(session.root, {title, ...blankTemplate(format,title)})` → `projects.reload()` → `executeCommand("labshelf.writing.openProject", entry)`; wrapped in `executeSafely`.
- Composition: vscode/src/activation/registration/registerWritingView.ts:160-190 (host, logger, data, projects). No template source, cache or save wired. Shared fetch with User-Agent: activation/serviceComposition/buildServices.ts:63.
- Engines: `findExecutable(name)` core/src/writing/latex/toolchain/node/findExecutable.ts:22 (via `@labshelf/core/node`); TeX Live builds need `latexmk` (vscode/src/writing/build/toolchain/node/toolchainSetup.ts); tectonic downloads on demand (`tectonicAsset(platform, arch)`, toolchain/node/tectonicSetup.ts:39); Typst is in-process wasm, always available. No availability probe exists; `ensureToolchain` (toolchainSetup.ts:59) may prompt.
- package.json: view `labshelf.writing` :392-397; viewsWelcome :435-438; view/title newProject :501, addExistingFolder :506, refresh :511; commands :236-248.
