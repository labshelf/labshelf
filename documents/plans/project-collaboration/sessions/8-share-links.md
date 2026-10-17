# Session 8 — Paper-folder share links

- **Goal:** a user shares a folder of papers as a link; anyone opens it read-only in a browser, downloads the PDFs or imports them into LabShelf; the owner can revoke it.
- **Starts from:** session 6 committed (the owner's Worker exists).
- **Ends with:** A11.
- **Owns:** `packages/core/src/share/`, `packages/core/__tests__/share/`, the share endpoints in `packages/core/src/relay/worker/`, `packages/vscode/src/share/`, the `labshelf.share.*` entries in `packages/vscode/package.json`, the share page in `website/`, `documents/contracts/share-link.md`.

Runs alone (manifest and website build).

Context: design `documents/plans/project-collaboration/research/share-links.md`. `website/` mounts core's library UI and reader through their host contracts with an in-page host (`documents/architecture.md`).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8.1 | Share format, upload, revoke | contract | implementer (opus), tests first → `architecture-reviewer` | share tests | [ ] |
| 8.2 | Worker share endpoints | contract | implementer (sonnet), tests first | endpoint tests | [ ] |
| 8.3 | Share page design | — | `ui-design` skill | design approved by the user | [ ] |
| 8.4 | Share page | behaviour | implementer (sonnet) | website build | [ ] |
| 8.5 | VS Code commands | behaviour | implementer (sonnet) | typecheck | [ ] |
| 8.6 | Real run | task | main thread, headless Chromium | A11 | [ ] |
| 8.7 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

8.1, 8.2 and 8.3 in parallel; 8.4 and 8.5 after.

## 8.1 — Format, upload, revoke

- **Read only:** `research/share-links.md`; `documents/contracts/library-format.md` (metadata, sidecar); `packages/core/src/hash/index.ts`; the 2.1 crypto API.
- **Decided:** as in the entry; manifest and blobs encrypted with the key in the link fragment (D16); the page origin is one constant, chosen here and filled in when the site is published (D17); with or without annotations chosen per share; PDFs over 25 MiB split; blobs reused by hash; revoke deletes the manifest and unreferenced blobs; the list of the user's shares is device-local. `share-link.md` written before code.
- **Done when:** tests first: manifest round trip, with/without annotations, split and reassembly, revoke keeps blobs another share uses.

## 8.2 — Worker share endpoints

- **Decided:** `GET /share/<id>/manifest`, `GET /share/<id>/blob/<hash>` with CORS `*`; `PUT`/`DELETE` need the owner secret; KV only; protocol minor version bump.
- **Done when:** tests first for the read, write and revoke paths.

## 8.4 — Share page

- **Read only:** 8.3 decisions; `website/src/demos/library.ts`; `documents/apps/README.md` ("Website").
- **Decided:** a read-only in-page host over the share data; Install LabShelf, Open in LabShelf, Download (PDF or zip); "This link was removed" after revoke; core components and `--ls-*` tokens only.
- **Done when:** `pnpm --filter @labshelf/website build` and typecheck pass.

## 8.5 — VS Code commands

- **Decided:** `labshelf.share.folder` ("Share Folder as Link…", on a folder in the library) with the copyright notice and the annotations choice; `labshelf.share.manage` lists shares with Copy link and Revoke. Errors toast and log.
- **Done when:** vscode typecheck and build pass.
