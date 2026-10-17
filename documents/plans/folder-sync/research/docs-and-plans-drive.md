sha: 3159f508
files: documents/**, website/index.html, scripts/googleCredentials.mjs, packages/*/build/*.mjs
source: Explore scout, 2026-10-17

# Docs, website, build and plans that assume Drive sync

Build: `scripts/googleCredentials.mjs` (`googleCredentialDefines("desktop"|"web")`, env `LABSHELF_GOOGLE_CLIENT_ID/_SECRET` or `credentials/google-<type>.json`, defines `__LABSHELF_GOOGLE_CLIENT_ID__/_SECRET__`), used by `packages/vscode/build/host.mjs:6,34`, `packages/terminal/build/build.mjs:6,28`, `packages/browser/build/build.mjs:6`. Consumer: `core/src/sync/auth/builtInGoogleClient.ts`. `credentials/*.json` is gitignored (`.gitignore:18-20`); keep the folder.

Docs:
- `documents/contracts/sync.md` (121 lines, all Drive). Linked from `documents/README.md:20-24`, `apps/README.md:14`, `apps/browser.md:5`, `apps/vscode.md:43`, `product.md:24`, `architecture.md:51`.
- `contracts/library-format.md:25,33,40,82,131,140,149,185,215` (appdata namespace, `sync/google-drive.*`, Drive identity, "Drive copy stays").
- `apps/README.md:3,12-30` (Google OAuth clients section); `apps/vscode.md:12,25,39,86,104`; `apps/terminal.md:5,12,16`; `apps/browser.md:5,16`; `documents/README.md:20-24,31`; `architecture.md:51` (`sync/` row), `:54` (Drive connection settings component); `product.md:5,24`.
- `website/index.html:160-161,191-198,209,213,227,243-251,276,311,505-524,568,579-580,608,627,638` (Drive diagram, §1.3 Connect Google Drive, §6 Drive sync, credentials, Google hosts in Table 10).

Plans:
- `browser-sync-drive-check` — entirely Drive: delete (user approved).
- `writing-project-templates` — session 6 is the Drive `templates` namespace (`plan.md:4,20,28,50` D15): delete session 6 and its row/decision (user approved).
- `writing-2-writing-sync` — partly: `plan.md:8,12,15,19,29,33`; sessions 01 (1.1), 2-merge, 3a-exchange (Drive file ids, `googleDriveProvider.ts`), 3c-live-sessions (Drive `lastModified`); 3b-comments unrelated.
- `browser-writing-companion` — partly: `plan.md:14,17,19,28,48,52`; sessions 1a-projects-store (browser joins Drive `projects` namespace), 2a-writing-tab, 2c-bibliography (Drive permissions API); 2d only wording.
- `browser-editor` — partly: `plan.md:4,8,17,32`; `sessions/03.md:8,27,40`.
- Unrelated: google-search-capture, pdf-finding-checks, pdf-preview-chrome, typst-source-sync, writing-2-research-links, writing-2-submission-tools, writing-3-writing-terminal.
