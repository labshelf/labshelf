sha: 3159f508
files: packages/vscode/src/writing/**, packages/core/src/writing/project/export/projectFiles.ts
source: GitHub API and raw sources read 2026-10-17; decisions with the user, 2026-10-17

# Reuse candidates and transport facts

## Verified (2026-10-17)
- **eclipse-oct/open-collaboration-tools**: GitHub reports MIT; last push 2026-10-02. Has `yjs-normalized-text.ts` (echo suppression, CRLF), remote cursors as decorations, retrying `WorkspaceEdit`; no undo handling. Its transport is its own server (TypeFox public instance), not P2P.
- **kermanx/p2p-live-share**: MIT; last push 2026-10-04. Per-file `Y.Doc`, `editingUris` echo guard, `src/fs/undo-manager.ts` (with a test) overriding undo/redo, Yjs + `y-protocols`, `msgpackr`, `birpc`. WebRTC runs **inside a webview**: `src/sync/trystero/index.ts` calls `rpc.trysteroJoinRoom/Send/ListenAction` over birpc to `src/webview/`, because the Node extension host has no `RTCPeerConnection`. It adds its own ack/resend layer (`src/sync/trystero/controller.ts`: per-peer sequence numbers, 2 s resend, 200 ms ack). It also has a WebSocket fallback server (`src/sync/ws/`, Go and TS).
- **dmotz/trystero**: MIT; active (2026-10-05). Strategies: Nostr, BitTorrent, MQTT, IPFS, Firebase, Supabase. Accepts `turnConfig` and a relay list.
- **kavinsood/yaos**: 0BSD; active. Server ~7,300 lines on y-partyserver, which decodes Yjs and so cannot hold E2EE ciphertext. Auth: "Claim" + hashed token, short-lived HMAC WebSocket tickets. Issue #40: a server that wrote per keystroke passed 100k requests/day from a few hundred typed words. DiskMirror: disk edits made outside the editor are diffed against the doc text and applied as Yjs edits.

## Not verified (session 1 checks)
- Whether either repo's binding can be imported as a library or must be copied with its licence notice (MIT allows copying with the notice; copied code goes to `packages/core/src/collab/` with a `LICENSE-<name>.md` beside it, as `core/src/ui/icons/` does).
- Whether a hidden or background webview keeps the WebRTC connection alive when the user closes every LabShelf view (`retainContextWhenHidden`, a `WebviewView` that stays resolved). Alternative: `node-datachannel` native binary in the extension host (per-platform builds; check VSIX size and the Marketplace platform-specific packaging).
- Nostr relay and BitTorrent tracker reliability for trystero signalling; how long a first connection takes; which strategy fails least on university networks (the user runs that check).
- `secsync` / naisho (SerenityNotes) repository location: the given URL redirects; find the current repo and licence.

## Binding traps (own binding if no reuse: ~600–1,000 lines + ~150 for undo)
- `WorkspaceEdit` is async and can fail when the document changed meanwhile: retry from the current doc state, never apply stale offsets.
- No synchronous edit API: remote edits arrive while a local edit is in flight; queue remote edits per document.
- CRLF: VS Code offsets count `\r\n` as two characters; normalise to `\n` in the doc and map offsets.
- Undo: VS Code undo would undo remote edits; a per-user `Y.UndoManager` with tracked origins replaces undo/redo in shared documents.
- Unsaved and closed documents: the doc is canonical; closed files update on disk through the disk mirror, open dirty files through the binding only.
- Initial content: on join, the local file is replaced by the doc text only after the doc has synced; a local file that differs and has unsynced edits is fed in as a diff, never overwritten blind.
