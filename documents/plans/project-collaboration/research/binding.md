sha: b0734410
files: packages/core/src/collab/**, packages/vscode/src/collab/**
source: shallow clones and `npm view`/`npm pack` read 2026-10-17

# Binding a Yjs `Y.Text` to a VS Code `TextDocument`

## Binding decision
**Copy with notice into `packages/core/src/collab/`**: OCT `yjs-normalized-text.ts` (CRLF map, echo guard, divergence reconcile) and p2p-live-share `undo-manager.ts` plus its test. Each keeps `LICENSE-open-collaboration-tools.md` / `LICENSE-p2p-live-share.md` beside it. **Write own** VS Code adapter in `packages/vscode/src/collab/` (edit queue, retrying `WorkspaceEdit`, undo command override, cursor decorations), using OCT and p2p as reference only, because both are welded to their sessions.

- **Licence.** OCT `LICENSE` is MIT (TypeFox GmbH 2024); every file read has a TypeFox MIT header. No EPL or dual licence anywhere (the only `EPL` grep hit is `DEEPL_AUTH_KEY`). p2p `LICENSE` is MIT (_Kerman 2025); `src/fs/` and `src/sync/` files have no per-file header, so the repo licence covers them.
- **npm.** `open-collaboration-yjs@0.3.1` is published (MIT, 2025-07-01) but lags the repo: its `yjs-normalized-text.ts` is 377 lines without `attachLocalDocument`/`reconcile` (the duplicate-seed fix). It depends on `open-collaboration-protocol`, which pulls `socket.io-client`, `msgpackr` and `fflate`, only for the `Disposable` and `Position` types. p2p-live-share is `private: true`; not on npm. No `y-vscode` package exists. Importing therefore gives stale code plus a transport we do not use.
- **Coupling.** OCT's normalized text imports only `yjs` and two protocol types: runtime-neutral once those become local types. Its VS Code side lives in `collaboration-instance.ts` (1,294 lines) mixed with rooms, file system, proposals and follow mode. p2p's `undo-manager.ts` imports only `yjs`. p2p's `common.ts` couples to `reactive-vscode` (`useCommand`, `useDisposable`) and module-level state.
- **CRLF.** OCT maps offsets per line (`originalOffset`, `normalizedOffset`) and keeps `\n` in the doc. p2p has none: it writes VS Code `rangeOffset` straight into `Y.Text` and applies Yjs indexes with `doc.positionAt`, so a CRLF file goes wrong.
- **Echo.** OCT skips `transaction.local` events and drops a local change set whose result equals a pending remote `before → after` (`shouldApply`). p2p ignores every `onDidChangeTextDocument` for a URI while a remote edit applies (`editingUris`). TRAP: that also drops keystrokes typed during the apply, which then never reach the doc.
- **Edit failure.** OCT retries `applyEdit` up to 20 times but rebuilds the edit from the same offsets, and covers drift with a debounced full-document replace (100 ms, max 500 ms) that resets cursors and the undo stack. p2p serializes edits per URI (`createSequentialFunction`) and does not retry. Our adapter queues per document and recomputes edits against the current version.
- **Undo.** OCT has none: VS Code undo reverts remote edits. p2p overrides `undo`/`redo` with a `Y.UndoManager` (tracked origin `LocalOrigin`), groups typing like the native editor, restores selections through relative positions, and falls back to `default:undo` outside shared documents. TRAP: undo produces a *local* transaction with origin = the manager; OCT's observer skips local transactions, so the copied normalized text must pass that origin through.
- **Tests.** OCT has no test for the binding (its tests cover agent, server and join URIs). p2p `undo-manager.test.ts` (311 lines, `node:test`) covers grouping, interleaved peer undo/redo and selection rebasing; it ports to our runner.
- **Size.** The copied normalized text is 434 lines: past the 300 hard limit, so it splits by responsibility (offset map / change-set echo guard) when copied.

## Functions LabShelf needs
Core (`packages/core/src/collab/`, runtime-neutral):
- `createNormalizedText(yText, onRemoteChanges)`: observes remote deltas, returns them in document (CRLF) offsets.
- `applyLocalChanges(changes)`: writes editor changes into `Y.Text` in one transaction, skipping echoes of applied remote changes.
- `attachLocalDocument(text)`: records editor content; reconciles instead of double-inserting when the doc seeds later.
- `toNormalizedOffset` / `toDocumentOffset`: map offsets between CRLF document and `\n` doc.
- `createUndoManager(doc)`: per-user `Y.UndoManager` with local origin, native-like grouping and selection capture.
- `toRelativeSelection` / `toAbsoluteSelection`: cursor positions that survive concurrent edits (awareness, undo).

VS Code (`packages/vscode/src/collab/`, adapter):
- `bindDocument(document, normalizedText)`: wires `onDidChangeTextDocument` to core and remote changes to the edit queue.
- `enqueueRemoteEdit(uri, changes)`: serializes per document; retries `applyEdit` recomputed against the current version; logs failures.
- `overrideUndoRedo(getUndoManager)`: registers `undo`/`redo`, delegating to `default:*` outside shared documents.
- `renderPeerCursors(editor, peers)`: one decoration type per peer for selection and name tag.

## Sources
- OCT [`bc7e301`](https://github.com/eclipse-oct/open-collaboration-tools/tree/bc7e3013984d2f15b213a6f7d700904d10a587a8): `packages/open-collaboration-yjs/src/yjs-normalized-text.ts` 434, `yjs-provider.ts` 132, `packages/open-collaboration-vscode/src/collaboration-instance.ts` 1,294 (binding: `registerTextDocument`, `updateTextDocument`, `applyEdit`, `renderTextPresence`, `getNormalizedDocument`, ~250 lines).
- p2p-live-share [`ebea0bd`](https://github.com/kermanx/p2p-live-share/tree/ebea0bda79853617f864a39944d57a5192bf57c6): `src/fs/common.ts` 192, `undo-manager.ts` 115, `undo-manager.test.ts` 311, `host.ts` 220, `guest.ts` 171; `src/sync/doc.ts` 208.

## Against reuse-and-transport.md "Not verified"
- Import or copy: **verified** — copy. p2p is not published; the published OCT package is stale and drags its transport.
- "No undo handling" (OCT) is confirmed; copying cuts the own code to the adapter (estimate ~400–500 lines, not measured) beside ~550 copied core lines.
