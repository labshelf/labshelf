# Plan: Project template library

Status: in progress
Size: 1 session remaining (of 6) — the `templates` Drive namespace; sessions 1 to 5 are committed.

## 1. Goal

Writers start a project from a template instead of a blank article, the way Overleaf's gallery works. Anyone can publish a template back without touching git or a terminal. The gallery lives inside the Projects tab and needs no LabShelf server. What remains is syncing My templates across the user's own devices through Drive.

## 2. Decisions

Facts: [research/](research/).

- [x] **D1** Three sources in one gallery: Typst Universe, the LabShelf Community catalog and My templates.
- [x] **D2** The Community catalog is the public repository `labshelf/labshelf-templates`, read through jsDelivr, never through the GitHub REST API.
- [x] **D3** The catalog's CI only validates (manifest schema, license, paths, sizes, image format). It never compiles.
- [x] **D4** The manifest declares the engine. The thumbnail and a sample PDF are compiled on the publisher's machine. The detail page offers "Compile on this machine".
- [x] **D5** Publishing needs only a GitHub sign-in: fork, branch, commit and pull request through the REST API.
- [x] **D6** VS Code signs in through its `github` authentication provider; terminal and browser use the GitHub device flow.
- [x] **D7** My templates are saved from any project into `<library>/templates/<id>/` and sync with Drive across the user's own devices. They are personal: sharing with a collaborator goes through the Community catalog. Drive sharing is out of scope.
- [x] **D8** The gallery belongs to the Projects tab. Its pieces are core components, so the browser can mount them later.
- [x] **D9** Template code is untrusted: no shell-escape, and `..`, absolute paths, symlinks and `latexmkrc` files are refused.
- [x] **D10** The manifest and catalog index are a contract in `documents/contracts/templates.md`.
- [x] **D11** VS Code asks its `github` provider for the `public_repo` scope; the OAuth App vs GitHub App choice for device flow belongs to the terminal and browser plans.
- [x] **D12** The browser device-flow CORS spike belongs to writing-3-writing-browser-bridge.
- [x] **D13** Typst Universe templates use the `@preview` resolver; `typst init` is our own code.
- [x] **D14** The gallery is an editor panel; the side bar stays a native tree.
- [x] **D15** My templates use a fourth Drive namespace, `templates` (`LabShelf Templates`, local `<library>/templates/<id>/`), added only after writing-2-writing-sync has finished `sync.md`.
- [x] **D16** Out of scope: likes, comments, ratings, usage stats, publishing without a GitHub account, compiling in CI, sharing templates through Drive. Browser and terminal gallery surfaces wait for writing-3-* and writing-4-browser-editor.

Open: none.

## 3. Acceptance

UI per [research/mockup.md](research/mockup.md). A1 to A3, A5 and A6 are met and committed.

- [x] **A1** Projects tab, Templates shows cards from all three sources, filterable by source, format, category and search. It opens offline from the cached index.
- [x] **A2** A card opens a detail page with preview, metadata, files and license; a missing local engine gets a warning.
- [x] **A3** Use template creates a project with all the template's files and opens its main file. A template with `..` or an absolute path is refused with a message.
- [ ] **A4** Save project as template stores the project under My templates, and it appears in the gallery on another device after sync.
- [x] **A5** Publish runs the checks and compiles the thumbnail locally. After Sign in with GitHub, Submit for review shows the pull request link.
- [x] **A6** A failing catalog fetch, sign-in or submit is logged through `ILogger` with context and shown to the user. No partial project is left on disk.

## 4. Sessions

Runner tiers: Sonnet for a complete brief, Opus/Fable for design.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 6 | [sessions/06.md](sessions/06.md) | My templates on Drive (`templates` namespace) | `documents/contracts/sync.md`, `documents/contracts/library-format.md`, `documents/contracts/templates.md`, `packages/core/src/sync/`, `packages/vscode/src/sync/` | alone |
