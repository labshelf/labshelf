# Session 2 — Core collaboration model and contract

- **Goal:** core has the runtime-neutral model of a shared project: keys and invite link, encryption framing, the Yjs doc layout, the shared-file rules, and the contract that pins them.
- **Starts from:** session 1 committed.
- **Ends with:** `documents/contracts/collaboration.md` (model parts), `library-format.md` gains `shared:`; core tests for every rule below pass. Nothing is wired to an app yet.
- **Owns:** `packages/core/src/collab/` (root files and `model/`, `crypto/`, `invite/` subfolders), `packages/core/__tests__/collab/`, `packages/core/package.json` (`yjs`, `y-protocols`), `documents/contracts/collaboration.md`, the contract list in `documents/README.md`, the `labshelf.yaml` section of `documents/contracts/library-format.md`.

Runs alone (adds dependencies); session 9 may run beside it.

Context: LabShelf users share a writing project folder; each holds a local copy; canonical content is Yjs, encrypted end to end, keys from an invite link. Design: `documents/plans/project-collaboration/research/collab-model.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Keys, invite link, encryption framing | contract | implementer (opus), tests first → `architecture-reviewer` | crypto tests | [ ] |
| 2.2 | Doc layout, shared files, settings split | contract | implementer (opus), tests first → `architecture-reviewer` | model tests | [ ] |
| 2.3 | Contract text | task | main thread | `collaboration.md` written | [ ] |
| 2.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

2.1 and 2.2 in parallel (disjoint: `collab/{crypto,invite}/` vs `collab/model/`); 2.3 after both.

## 2.1 — Keys, invite link, encryption framing

- **Goal:** a project key, derived keys, the invite link and authenticated encryption of every payload.
- **Read only:** `research/collab-model.md` ("Identity and keys"); `packages/core/src/hash/index.ts`; `documents/contracts/links.md` (an existing link format, for style).
- **Decided:**
  - WebCrypto only (`globalThis.crypto.subtle`), so the folder stays runtime-neutral. HKDF-SHA-256 labels `share-id`, `content`, `awareness`, `room`, `relay`. AES-GCM 256, random 96-bit nonce per message.
  - Frame: `version byte | nonce | ciphertext`; additional data = `shareId | doc key | kind` so a frame cannot be replayed into another doc.
  - Invite: `labshelf://join#v1.<shareId>.<base64url key>.<base64url relay list>`; parse validates every part and returns a typed error, never throws on user input.
  - Key rotation: `rotateProjectKey(current)` gives a fresh key and shareId; frames under the replaced key stay readable to the owner only, for re-encryption.
- **Done when:** tests first: round trip, tamper and wrong key fail, AAD mismatch fails, malformed invites give each error; core typecheck and `collab` tests pass.
- **Do not touch:** `collab/model/`.

## 2.2 — Doc layout, shared files, settings split

- **Goal:** pure functions that map a project folder to its docs and back.
- **Read only:** `research/collab-model.md` ("Docs per project"); `packages/core/src/writing/project/export/projectFiles.ts`; `packages/core/src/writing/project/projectFile.ts` (keys and rewrite); `documents/contracts/library-format.md` 88–147.
- **Decided:**
  - Index doc: `files` (`path → {kind, hash?}`), `settings` (shared `labshelf.yaml` keys), `comments` (left empty; session 5 fills it).
  - `isSharedPath(path)` reuses the export filter's exclusions (move the shared part into one exported function, update `projectFiles.ts` to use it; no copy) and admits `.labshelf/checklist.json` and `.labshelf/comments.json`.
  - `isTextFile(path, bytes)`: known text extension and valid UTF-8.
  - Settings split: `sharedSettings(yaml)` / `applySharedSettings(localYaml, shared)` keep `id`, `folder`, `archived`, `trashed` local and keep comments and unknown keys (existing rewrite rules).
  - Shared `labshelf.bib`: `mergeGeneratedBibliography(sharedText, generated)` adds and updates entries, never removes one.
  - `labshelf.yaml` key `shared: <shareId>` (string); malformed fails to parse with the key in the reason, like the other keys.
- **Done when:** tests first for each function, including a collaborator lacking a paper; core typecheck and tests pass; the `shared` row is in `library-format.md`.
- **Do not touch:** `collab/crypto/`, `collab/invite/`.

## 2.3 — Contract text

- **Steps (main thread):** write `documents/contracts/collaboration.md`: invite link, key derivation, frame, doc layout, shared files, settings split, bibliography rule, device-local state (link folder-sync's state-dir rule, do not repeat it). Add it to `documents/README.md`'s contract list. Present tense; sessions 3 to 5 add sync messages, awareness and comments.
