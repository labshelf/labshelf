# Session 5 — managed Tinymist for the helper and VS Code

- **Goal:** LabShelf installs and updates a pinned Tinymist binary in the shared managed folder; the helper relays LSP to it for the browser, and the VS Code extension runs it as its Typst language server without the Tinymist extension.
- **Starts from:** session 4 committed.
- **Ends with:** A11; the helper answers `lsp` messages from session 4's contract; tests pin install, verification and resolution.
- **Owns:** `packages/core/src/writing/typst/toolchain/`, `documents/contracts/managed-tex.md` (renamed per plan Q2), `packages/core/src/writing/helper/node/lsp/`, `packages/vscode/src/writing/typst/`, `packages/vscode/package.json` (dependency `vscode-languageclient`, removal of any Tinymist extension prompt or dependency).

Runs alone: it changes `packages/vscode/package.json`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Managed Tinymist install | contract | implementer (opus), tests first | install/verify/resolve tests pass | [ ] |
| 5.2 | Helper LSP relay | contract | implementer (sonnet), tests first | relay tests pass | [ ] |
| 5.3 | VS Code language server | behaviour | implementer (sonnet) | A11 in an isolated host | [ ] |
| 5.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 5.1 — Managed Tinymist

- **Read only:** `documents/contracts/managed-tex.md` (all); `packages/core/src/writing/latex/toolchain/node/managed/` index and the lock module; core `downloadVerified` (find with one grep).
- **Decided:** the contract becomes `managed-tools.md` with a Tinymist section: folder `tinymist/<version>/` beside `tex/` (same per-OS root), a pinned version and per-target SHA-256 table in core, download from Tinymist's GitHub release through `downloadVerified`, installed under the same `.lock`, resolution managed → `tinymist` on PATH → missing. Install happens on first Typst use, with `progress` frames in the helper.
- **Done when:** tests over a fake fetch: hash mismatch rejected, concurrent install waits on the lock, PATH fallback.

## 5.2 — LSP relay

- **Read only:** helper.md (`lsp`); `packages/core/src/writing/helper/node/socket/` from session 4; `node/dispatch/dispatcher.ts`.
- **Decided:** one Tinymist process per opened Typst project, started on first `lsp`, stopped on `closeProject` or socket close; Content-Length framing to the child; `edit` messages also become `textDocument/didChange` so the server sees unsaved text; Typst compile for `compile` uses Tinymist's export (or `typst compile` if Tinymist cannot export pages) and returns changed pages. The relay never forwards `workspace/executeCommand` from the page.
- **Done when:** tests with a fake child process pin framing, lifecycle and the refused method.

## 5.3 — VS Code

- **Read only:** `packages/vscode/src/writing/typst/` index; `packages/vscode/package.json` (`extensionDependencies`, Typst contributions); the activation file that registers Typst features.
- **Decided:** `vscode-languageclient/node` starts the managed binary for `typst` documents; any prompt to install the Tinymist extension is deleted with its strings and settings. Verify only in an isolated `@vscode/test-electron` host with its own user-data-dir, after asking the user; never kill VS Code by name.
- **Done when:** vscode typecheck and test; A11 observed and reported with what was not checked.
