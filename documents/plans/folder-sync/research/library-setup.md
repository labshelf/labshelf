sha: 3159f508
files: packages/core/src/library/**, packages/vscode/src/storage/paths/libraryLocation.ts, packages/vscode/src/activation/libraryLifecycle/**, packages/terminal/src/main.ts, packages/terminal/src/app/config.ts, documents/contracts/library-format.md
source: Explore scout, 2026-10-17

# Library location, first run, watchers, device-local state

Shared config: `core/src/library/sharedConfig.ts:1-20` (`SharedConfig {version:1; libraryRoot?; [namespace]: unknown}`, one level merge); `core/src/library/node/sharedConfigFile.ts` (`$XDG_CONFIG_HOME/labshelf/config.json`, `readSharedLibraryRoot` only absolute, `updateSharedConfig` atomic). Contract: `library-format.md` "Shared configuration" (~line 260).

VS Code first run: `vscode/src/extension.ts:115-150` `loadConfiguredLibrary` → `resolveLibraryRoot` (`storage/paths/libraryLocation.ts:13`, needs an existing dir); no root → info toast "No library configured… Configure Library". No `viewsWelcome`. `labshelf.configureLibrary` (`activation/registration/registerLibraryCommands.ts:44`) → `controller.reconfigure()` (`activation/libraryLifecycle/libraryRootController.ts:51`) → `runLibrarySetupWizard` (`libraryLocation.ts:53-100`): `showOpenDialog` for a parent, `showInputBox` name (default "LabShelfLibrary"), root `<parent>/<name>`, creates `requiredDirs`, writes shared config. Cannot pick an existing library directly. `applyRoot` (`libraryRootController.ts:66`) builds services, fires `onDidChangeRoot`, starts the watcher.

Terminal first run: `terminal/src/main.ts:21` `DEFAULT_LIBRARY="~/LabShelfLibrary"`; `app/config.ts:51` `resolveLibraryRoot` (`--library`/`-L`, env `LABSHELF_LIBRARY`, `config.libraryRoot`); `main.ts:~52-72` `resolveRoot` (`looksLikeLibrary` else error / prompt); `askForLibrary` `main.ts:39` readline; `adoptLibrary` `main.ts:30` (`ensureLibraryStructure`, `updateSharedConfig`); `labshelf init [path]`.

Format (`library-format.md:1-45`): `papers/<folders…>/<paper id>/{paper.pdf, metadata.yaml, bib.bib, …}`; `projects/<id>/labshelf.yaml`; `templates/`; hidden `.research/` with `papers/<id>/data.json` (sidecar), `projects.json`, `logs/`, `sync/`, `index.sqlite`, `openalex/`, `staging/`. Library recognised by `markerDirs()` = `papers/` or `.research/` (`core/src/library/layout.ts:85`); `requiredDirs` `layout.ts:84`. Paper = folder with `metadata.yaml`; id = folder name = cite key. Sidecar keyed by id; bytes must be identical across apps (contract ~line 253).

Device-local files that a sync tool would copy and conflict: `.research/index.sqlite` (Related tab only), `.research/logs/`, `.research/projects.json` (`{folders:[abs paths]}` registry of external project folders, `core/src/writing/project/node/projectRegistryFile.ts`), `.research/openalex/`, `.research/staging/`. `cacheDir()` (`core/src/library/node/cacheDirectory.ts`) holds builds, thumbnails, OCR cache.

Watchers: VS Code `vscode/src/storage/data/externalChangeWatcher.ts` (FileSystemWatcher `papers/**` + `.research/papers/**/data.json`, 1 s debounce) → `activation/libraryLifecycle/externalChangeHandling.ts:22` `reindexLibrary()` + refresh, WARN on failed reindex. Terminal `terminal/src/library/libraryWatcher.ts` (recursive `fs.watch`, 250 ms debounce, 5 s polling fallback; no `projects/`). Noise filter `core/src/library/externalChange/noiseFilter.ts` (`.<name>.<uuid>.tmp`, `.DS_Store`, `*~`, `*.swp`). Neither watches the root itself (unmounted root → silent "no library"). Atomic writes `core/src/library/node/atomicWrite.ts` (temp + rename; direct write on EXDEV). How reindex handles a half-written `metadata.yaml`: unchecked.

Multiple libraries: not supported (`libraryRoot` is one string; `LibraryRootController` holds one root).

Reusable core UI: `core/src/ui/dom/widgets/{dialog,quickInput,toast,menu,overlay}.ts`; `core/src/ui/dom/settings/` (`settingsPage`, `settingsSection`, `settingRow`, `actionButton`, `statusLine`); `core/src/library-ui/dom/list/emptyState.ts`; `core/src/writing/allProjects/dom/projectEmptyState.ts`; `core/src/ui/dom/dom.ts` `el()`; icons `core/src/ui/icons`. No first-run component exists.
