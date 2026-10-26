# Plan: Project collaboration — shared writing projects and paper share links

Status: approved
Size: 11 sessions — spikes, core model and contract, transport, VS Code editing, comments, the owner's Cloudflare relay, relay failover, paper share links, the browser-editor plan reconciled, and relay-only collaboration with Cloudflare sign-in, and the real run on two accounts

## 1. Goal

LabShelf users share a writing project (a LaTeX or Typst folder) with other LabShelf users and edit it together live in VS Code, with other people's cursors and anchored comments; each collaborator keeps a full local copy and can work while the others are offline. A user can also share a folder of papers (a course, a congress) as a read-only link. There is no server run by Luca and no cost to him: collaborators sync end to end encrypted through relays that LabShelf installs in their own Cloudflare accounts, and at least one collaborator connects one by signing in to Cloudflare.

## 2. Decisions

- [ ] **D1** Plan `folder-sync` runs first. Its results are premises here: a library is a plain folder synced by the user's tool, LabShelf calls no cloud API for the library, device-local state lives in the state dir keyed per library, conflict copies are handled, a Native Messaging bridge links the browser to the folder (`folder-sync/plan.md`, `folder-sync/research/folder-rules-decisions.md`). — Collaboration sits on top of a folder library.
- [ ] **D2** Every collaborator holds a local copy of the project in their own library (`projects/<id>/`). Canonical content is one Yjs document per text file plus an index document (file list, shared `labshelf.yaml` settings, comments); files on disk are written from it, and disk edits made outside the editor enter the doc as diffs (YAOS DiskMirror). Binary files are content-addressed blobs. Yjs state is device-local. Detail: `research/collab-model.md`. — Editing never needs the owner online.
- [ ] **D3** `labshelf.yaml` is not shared as text: `id`, `folder`, `archived`, `trashed` stay per user; the other keys sync through the index doc and each client writes them with the existing rewrite rules. `labshelf.bib` is shared, and in a shared project the generator only adds and updates entries. — Organisation is personal; a collaborator without a paper must not delete its entry.
- [ ] **D4** Transport: the Cloudflare relay of D10 is the only transport; there is no WebRTC, no public signalling and no TURN. Everything (updates, snapshots, blobs, awareness) is end-to-end encrypted with keys derived from a share key (D18) carried in the invite link's `#fragment`. — Public Nostr relays are third-party infrastructure that rate-limits at scale, TURN exists only for P2P, and `node-datachannel` is a native dependency; the relay already does the job. User choice, 2026-10-18 (replaces direct WebRTC through trystero).
- [ ] **D5** Invite and membership: anyone holding the invite is an editor; no roles. Removing someone means the owner rotates the key and re-invites the rest. Keys live in VS Code `SecretStorage`, never in the project folder. — Simplest model that is still safe.
- [ ] **D6** Placement: runtime-neutral model, crypto (WebCrypto), invite format, sync protocol and relay protocol in `packages/core/src/collab/`; the WebRTC transport in `collab/dom/`; disk mirror and device-local state in `collab/node/`; the Worker in `packages/core/src/relay/worker/` (a Cloudflare Workers runtime folder; `architecture.md` gains this rule) and its API deploy client in `relay/client/`; share links in `packages/core/src/share/`. VS Code holds commands, the binding glue, the webview host and the comments controller. — documents/architecture.md#packages: the browser editor reuses all of it.
- [ ] **D7** The VS Code binding is reused before it is written: session 1 decides between importing or copying (with its MIT notice) code from Open Collaboration Tools or p2p-live-share, and writing our own (~600–1,000 lines + ~150 for undo). Shared documents get a per-user `Y.UndoManager`. Traps: `research/reuse-and-transport.md`. — Both projects are MIT and active.
- [ ] **D8** Comments are anchored to text ranges with Yjs relative positions plus a quote anchor, live through the index doc, and persisted to `<project>/.labshelf/comments.json`. Cursors and selections go through Yjs awareness, encrypted. — Comments survive edits and work in unshared projects.
- [ ] **D9** Group size: every client connects to the relay in use; the free plan's budget (`research/cloudflare-free-plan.md`) is the limit, not a peer count. — There is no mesh.
- [ ] **D10** Relay on a collaborator's own Cloudflare account: stores encrypted updates and client-written encrypted snapshots (secsync model: the relay never merges or decodes) and forwards over WebSocket. The user connects Cloudflare by signing in once in the browser (OAuth Authorization Code + PKCE with `offline_access`; the refresh token rotates and lives in `SecretStorage`); pasting an API token is the fallback for remote hosts. LabShelf deploys and updates the Worker through the Cloudflare API (not the "Deploy to Cloudflare" button, which has no update path). Sign-in ends on `labshelf.org/connected/`. The Worker is minimal (a few hundred lines), protocol-versioned, backward compatible, checked and updated on every LabShelf start; clients batch writes. Limits and rules: `research/cloudflare-free-plan.md`. — Luca's code runs in accounts he cannot see; the free plan must hold. Sign-in replaces the pasted token: user choice, 2026-10-18, after a real refresh past expiry on two accounts.
- [ ] **D11** Later phase: a project carries a list of relays from members who connected Cloudflare; clients use the first that answers in list order and fail over together. CRDT state lives in clients, so relays are interchangeable. — The only way pooling adds capacity.
- [ ] **D12** Paper share links: LabShelf uploads copies of the chosen papers (with or without the user's annotations, the user chooses) to the owner's Worker KV; a page of `website/` shows the folder read-only without sign-in, with Install LabShelf, Open in LabShelf (import) and Download. Revoke deletes. A notice says the sharer is responsible for the right to share. Detail: `research/share-links.md`. — Free at course scale (20 papers × 100 students).
- [ ] **D13** Contracts this plan adds, tests first, reviewed by the `finish` skill: `documents/contracts/collaboration.md` (invite link, key derivation, encryption framing, doc layout, awareness, sync messages), `documents/contracts/relay.md` (Worker endpoints, versioning, auth), `documents/contracts/share-link.md`. `library-format.md` gains `shared:` in `labshelf.yaml` and `.labshelf/comments.json`.
- [ ] **D14** Out of scope: mobile; the browser editor (plan `browser-project-workspace` session 14 joins through this protocol); sharing whole libraries live; any server Luca pays for.

- [ ] **D15** This plan absorbs `writing-2-writing-sync` session 3b (comments, controller, review-PDF note) as session 5; its session 3c (OCT bridge, coauthor notice) and decisions D5–D8 are deleted from that plan, whose three-way merge stays. — user choice, 2026-10-17.
- [ ] **D16** Share-link contents (manifest and PDFs) are encrypted with a key in the link `#fragment`; the owner's account holds only ciphertext. — user choice, 2026-10-17.
- [ ] **D17** Session 8 decides the share page's origin; it is one constant in `core/src/share/`, filled in when the site is published. — user choice, 2026-10-17.
- [ ] **D18** The unit that is shared is a *share*, and a project is its only kind in this plan. Keys, invite, frames, sync messages and the relay are named for the share (`shareKey`, `rotateShareKey`) and never read the kind; the index doc carries `kind: "project"`, and a client rejects an unknown kind with a typed error. `collaboration.md` keeps the kind-independent parts apart from the project layout. Nothing else is generic: no item list, no registry. — A later plan shares paper folders, Notebook entries and groupings as new kinds without changing keys, frames or the relay; user choice, 2026-10-17.
- [ ] **D19** In a shared project, `mergeGeneratedBibliography` updates an existing entry only when the local paper is the same work: same DOI, else same arXiv id, else the entry has neither. A local paper with the same cite key and another identity leaves the entry untouched and logs a warning. — Two libraries can give one cite key to two different papers; updating would overwrite the coauthor's reference with the wrong paper.

- [ ] **D20** Sharing a project requires a connected Cloudflare account: "Share Project…" runs "Connect Cloudflare…" first when none is connected. — Relay-only transport (D4); signing in takes a minute. User choice, 2026-10-18.
- [ ] **D21** The share page origin is `https://labshelf.org`, served from the `labshelf-website` Worker (static assets, `website/wrangler.jsonc`) in the LabShelf Cloudflare account; the OAuth client is public with that domain verified. — Settles D17. User choice, 2026-10-18.

- [ ] **D22** A group never stays split across relays: the client with the lowest awareness id on the relay in use watches every other listed relay over an awareness-only socket and adopts down marks published there, and a client that sees its group on an earlier relay retries it at once. — A relay can refuse some sockets while answering `/version`; a one-hour split is not acceptable. User choice, 2026-10-18.

Open: none.

## 3. Acceptance

- [ ] **A1** The owner runs "Share Project…" and gets an invite link; a second user runs "Join Shared Project…" with it and gets the project under `projects/` in their library with the same files.
- [ ] **A2** Typing in one VS Code appears in the other within about a second, with the other person's named, coloured cursor and selection.
- [ ] **A3** B edits while A is offline; when both are online again, both edits are in the doc and on both disks, with no text lost.
- [ ] **A4** A change made outside the editor (git pull, another editor) on A's disk reaches B as an edit; replacing a figure on A gives B the same bytes.
- [ ] **A5** Undo in a shared file undoes only the user's own edits.
- [ ] **A6** A comment thread on a text range shows at the same text for B, stays anchored when the text moves, can be replied to and resolved, and is in `.labshelf/comments.json`.
- [ ] **A7** A relay dump contains no plaintext; a client with a wrong key cannot read anything.
- [ ] **A8** After signing in to Cloudflare, LabShelf deploys the Worker; B catches up from the relay while A is offline; starting LabShelf with a newer bundled Worker updates the deployed one; an hour of three people typing stays under 2,000 relay requests.
- [ ] **A9** "Share Project…" without a connected Cloudflare account asks to connect one first, and cancelling cancels the share.
- [ ] **A10** With two relays in the list, stopping the first moves every client to the second without losing edits, also when the first refuses only new connections and a newcomer joins meanwhile.
- [ ] **A11** "Share Folder as Link…" gives a link that opens the folder read-only in a browser without LabShelf; Open in LabShelf imports the papers; after revoke the page says the link was removed.
- [ ] **A12** The browser editor (plan `browser-project-workspace`) joins shared projects through this plan's protocol and stays within its file limits.
- [ ] **A13** A user signs in to Cloudflare once; after the access token expires LabShelf renews it without asking, and a restarted VS Code updates the relay without a sign-in.

## 4. Sessions

Sessions run in order. Every session from 2 to 8 and session 10 adds or removes a dependency or changes a manifest or build script, so each runs alone; session 9 (documents only) runs with session 2.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-spikes.md](sessions/1-spikes.md) | reuse decision, WebRTC host, signalling, Cloudflare API, campus check | `documents/plans/project-collaboration/research/**`, scratch dirs outside the repo | alone |
| 2 | [sessions/2-core-model.md](sessions/2-core-model.md) | docs, keys, invite, crypto, `collaboration.md` | `packages/core/src/collab/` (root), `documents/contracts/{collaboration,library-format}.md` | 9 |
| 3 | [sessions/3-transport.md](sessions/3-transport.md) | encrypted P2P sync with reconnect | `packages/core/src/collab/{sync,transport,dom}/` | alone |
| 4 | [sessions/4-vscode-editing.md](sessions/4-vscode-editing.md) | share/join, binding, undo, cursors, disk mirror | `packages/core/src/collab/node/`, `packages/vscode/src/collab/` | alone |
| 5 | [sessions/5-comments.md](sessions/5-comments.md) | anchored comments | `packages/core/src/collab/comments/`, `packages/vscode/src/collab/comments/`, reader review-note request | alone |
| 6 | [sessions/6-cloudflare-relay.md](sessions/6-cloudflare-relay.md) | Worker, API deploy, persistence, relay, TURN | `packages/core/src/relay/`, `packages/vscode/src/relay/`, `documents/contracts/relay.md` | alone |
| 7 | [sessions/7-relay-list.md](sessions/7-relay-list.md) | relay list and failover | `packages/core/src/collab/relays/`, relay-offer glue in `packages/vscode/src/relay/` | alone |
| 8 | [sessions/8-share-links.md](sessions/8-share-links.md) | paper-folder share links and page | `packages/core/src/share/`, share endpoints in `relay/worker/`, `packages/vscode/src/share/`, `website/`, `documents/contracts/share-link.md` | alone |
| 9 | [sessions/9-browser-editor-plan.md](sessions/9-browser-editor-plan.md) | `browser-editor` reconciled | `documents/plans/browser-editor/**` | 2 |
| 10 | sessions/10-relay-only-sign-in.md (done) | relay-only transport, Cloudflare sign-in, re-probe, relay watch, real-run fixes | — | alone |
| 11 | [sessions/11-real-run.md](sessions/11-real-run.md) | A7–A10, A13 on accounts A and B | scratch dirs | alone |
