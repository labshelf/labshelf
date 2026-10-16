# Plan: Project template library

Status: in progress (session 2 of 6)
Size: GG — a new contract, a fourth Drive namespace, a new UI surface, a GitHub client and an outside catalog repository; 6 sessions. It would grow if publishing needs a GitHub App of our own.
Pending decisions: 0

## 1. Goal

Writers start a project from a template instead of a blank article, the way Overleaf's gallery works. Anyone can publish a template back without touching git or a terminal. The gallery lives inside the Projects tab and needs no LabShelf server.

## 2. Decisions

D1–D10 were agreed with the user in conversation on 2026-10-16. D11–D15 are the recommendations for Q1–Q5, applied from research/. Facts: [research/](research/).

- [x] **D1** Three sources in one gallery: Typst Universe, the LabShelf Community catalog and My templates. Together they cover the public Typst catalog, LaTeX classes and a lab's own layouts.
- [x] **D2** The Community catalog is a public GitHub repository (`labshelf-templates`) with one folder per template and a generated `index.json`. It is read through jsDelivr, never through the GitHub REST API, so it needs no server and has no 60-requests-per-hour limit on reads.
- [x] **D3** The catalog's CI only validates: manifest schema, license field, paths inside the template, file sizes and image format. It never compiles, because a CI engine is not the publisher's engine.
- [x] **D4** The manifest declares the engine (`tectonic`, `pdflatex`, `lualatex`, `xelatex`, `typst`). The thumbnail and a sample PDF are compiled on the publisher's machine and ship with the submission. The detail page offers "Compile on this machine".
- [x] **D5** Publishing needs only a GitHub sign-in. The app forks the catalog, creates a branch, commits the files and opens the pull request through the REST API.
- [x] **D6** VS Code signs in through its built-in `github` authentication provider. Terminal and browser use the GitHub device flow.
- [x] **D7** My templates are saved from any project ("Save project as template") into the library and sync with Drive across the user's own devices. They are personal: to share a template with a collaborator, the user publishes it to the Community catalog and the collaborator downloads it there.
- [x] **D8** The gallery belongs to the Projects tab. Its pieces are core components, so the browser can mount them once it has a Projects tab.
- [x] **D9** Template code is untrusted. Never enable shell-escape for a template build. Refuse `..`, absolute paths, symlinks and `latexmkrc` files on download and on publish.
- [x] **D10** The template manifest and the catalog index become a contract in `documents/contracts/templates.md` before any code reads them.
- [x] **D11** VS Code asks its `github` provider for the `public_repo` scope, so no OAuth or GitHub App of ours is involved in this plan. The OAuth App vs GitHub App choice for device flow moves to the terminal and browser plans, with a `council` there. *(Q1)*
- [x] **D12** The browser device-flow CORS spike moves to writing-3-writing-browser-bridge, because the browser is out of scope here. *(Q2)*
- [x] **D13** Typst Universe templates use the existing `@preview` resolver in VS Code ([research/typst-packages.md](research/typst-packages.md)). `typst init` is our own code: it downloads the package tar.gz and copies its `[template] path` folder. Cards use the served thumbnails `preview/thumbnails/<name>-<version>-small.webp`. A template whose `compiler` is newer than the bundled one gets the A2 warning. Index, thumbnails and archives all send `access-control-allow-origin: *` ([research/typst-universe.md](research/typst-universe.md)). *(Q3)*
- [x] **D14** The gallery is an editor panel, opened from the Projects view title, its welcome and New project. The side bar stays a native tree, as writing-project-workspace D11/D13 keep it. *(Q4)*
- [x] **D15** My templates use a fourth Drive namespace, `templates` (`LabShelf Templates`, local `<library>/templates/<id>/`). It is added only after writing-2-writing-sync has finished `sync.md`. *(Q5)*

Open, asked at the start of session 4 and not blocking approval:

- **Q6** Answered: `labshelf/labshelf-templates` (public, in the `labshelf` organisation).

## 3. Scope

- **In:** the VS Code gallery (browse, filter, detail, use template, save as template, publish); core manifest, catalog sources, install, publish and My-templates logic behind ports; the catalog repository's validator and index generator; the `templates` sync namespace.
- **Out:** likes, comments, ratings, usage stats, publishing without a GitHub account, compiling in CI, sharing templates through Drive. Browser and terminal surfaces wait for their writing plans (writing-3-*, writing-4-browser-editor).
- **Contracts touched:** new `documents/contracts/templates.md`; `library-format.md#layout` (`templates/`, `.research/templates/`); `sync.md#namespaces-on-drive` (`templates`).

## 4. Acceptance criteria

UI per [research/mockup.md](research/mockup.md) (canvas https://claude.ai/artifact/WFi8ohRscqdE3aBW8yQv82), opened from the Projects tab.

- [ ] **A1** Projects tab → Templates shows cards from all three sources, filterable by source, format, category (Article, Thesis, Poster, Slides, CV) and search. It opens offline from the cached index.
- [ ] **A2** A card opens a detail page with the preview, metadata, files and license. When the engine is not available locally, a warning names the missing engine.
- [ ] **A3** Use template creates a project with all the template's files and opens its main file. A template with `..` or an absolute path is refused with a message.
- [ ] **A4** Save project as template stores the project under My templates, and it appears in the gallery on another device after sync.
- [ ] **A5** Publish runs the checks (builds with the declared engine, no shell-escape, paths inside the project, license set) and compiles the thumbnail locally. After Sign in with GitHub → Submit for review, it shows the pull request link.
- [ ] **A6** A failing catalog fetch, sign-in or submit is logged through `ILogger` with context and shown to the user. No partial project is left on disk.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Manifest, index, path rules, filter | `core/src/writing/templates/` | runtime-neutral parse and validate; `blankTemplates` absorbs `project/templates.ts` |
| Catalog sources | `core/src/writing/templates/sources/` | `TemplateSource` port: `list()`, `files(entry)`. Community: injected fetch plus an ETag cache port. Universe: index plus tar.gz. Mine: library fs |
| Install | `core/src/writing/project/node/` | stage in `.research/staging/`, validate every path, rename into `projects/<id>/`, write `labshelf.yaml` last. Replaces `createProject({title, format})`: blank templates go through the same path |
| My templates store | `core/src/writing/templates/node/` | `<library>/templates/<id>/`; save excludes `.labshelf/{versions,rebuttal}/`, `comments.json`, `state.json`, `checklist.json`, `papers:` and the build dir |
| Thumbnail | `core/src/import/node/canvas/` | one `renderFirstPagePng` used by templates, the terminal `thumbnailWorker` and `compare/renderInkMaps` |
| GitHub client | `core/src/github/` | runtime-neutral, injected fetch and token: fork, wait, blobs, tree, commit, ref, pull request |
| Publish checks | `core/src/writing/templates/node/` | builds through the existing `runLatexBuild`/`runTypstBuild`, then path, size, license and `latexmkrc` checks |
| Gallery UI | `core/src/writing/templates/dom/` + `protocol/` | card grid, gallery, detail, publish form; message union and guards as in `library-ui/protocol` |
| VS Code host | `vscode/src/writing/templates/` | editor panel (webview recipe from `ui/list/`), `GitHubAuth` adapter over `vscode.authentication`, commands |
| Catalog repository | sibling repo `labshelf-templates` | `validate.mjs` and `build-index.mjs` bundled from core by `scripts/template-catalog.mjs`, so there is one validator; a GitHub Actions workflow |

Shapes (final form in the contract, session 1):

- `template.yaml` at the template root: `schema: 1`, `id`, `name`, `description`, `category`, `format`, `engine`, `main`, `license` (SPDX), `authors`. Sources sit under `files/`, and `preview/thumbnail.png` and `preview/sample.pdf` sit beside them. A different name from `labshelf.yaml` keeps the project scanner blind to templates.
- `index.json`: `schema: 1`, `templates[]` = manifest fields plus `files[] {path, size, sha256}`, thumbnail and sample paths. Downloads are checked against `sha256`. On a mismatch, the download is refused with "catalog is updating, try again later".
- Device cache: `<library>/.research/templates/{community,universe}/` holds the index, its ETag and the thumbnails. It is never synced.

Doors: S1.1 (contract), S5.x (Drive and GitHub writes) and S6.x (sync namespace) are one-way. None has a second viable design, so none goes to `council`: research/plans-overlap.md rejects the alternatives for the namespace, and D11 removes the app-type fork.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Contract, core model, catalog sources | yes |
| 2 | [sessions/02.md](sessions/02.md) | Install from template, save as template (local) | yes |
| 3 | [sessions/03.md](sessions/03.md) | Gallery and detail in VS Code | yes |
| 4 | [sessions/04.md](sessions/04.md) | Catalog repository: validator, index, CI, seed | yes |
| 5 | [sessions/05.md](sessions/05.md) | Publish: checks, thumbnail, GitHub, pull request | yes |
| 6 | [sessions/06.md](sessions/06.md) | My templates on Drive (`templates` namespace) | yes |

Sessions 1, 2 and 4 can start now. Session 3 waits for writing-project-workspace sessions 2 and 6. Session 6 waits for writing-2-writing-sync to finish.

Runner tiers: **H** session model; **M** Sonnet; **L** Haiku.

## 7. Risks

- **R1** A community template carries a malicious build step — D9, plus review on the pull request.
- **R2** Overlap with writing-project-workspace and writing-2-writing-sync on the Projects tab and the Drive namespaces — the session waits in §6.
- **R3** jsDelivr caches `@main` for up to 12 h — `sha256` in the index refuses mixed versions; the gallery shows the cached index.

## 8. Log

See [log.md](log.md).
