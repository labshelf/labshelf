# Contract: share links

Read when you change how a folder of papers is shared as a link, what the owner's Worker stores for it, or how the share page opens it.

A share link gives anyone who has it a read-only copy of a folder of papers. LabShelf uploads the copies, encrypted, to the owner's [relay Worker](relay.md); the share page on labshelf.org decrypts them in the browser. The apps, the site and older or newer Workers all read what is below, so the link, the encryption and the manifest are frozen.

## Link

`https://labshelf.org/share/#<worker host>/<share id>/<link key>`

- The worker host is the host of the owner's Worker URL.
- The share id is 16 random bytes as hex, independent of the key, so the Worker's paths reveal nothing about it.
- The link key is 16 random bytes in the fragment, which browsers never send. The owner's account therefore holds only ciphertext.
- An app accepts any origin whose path ends in `/share/`, and percent-decodes the fragment first (VS Code may encode its slashes).

## Encryption

The derivation labels are frozen.

- **Manifest**: AES-GCM key derived from the link key, sealed as one [frame](collaboration.md#frame) bound to the share id.
- **PDF parts** are convergent: key and nonce derive from the SHA-256 of the part's plaintext. One key then seals one plaintext, so the fixed nonce is never reused, and equal PDFs are equal blobs, uploaded once across shares. The trade-off: the owner's account can see that two shares hold the same PDF, or confirm a guess of its bytes. That is accepted, because the owner is the sharer and has the PDFs.
- A reader checks the blob hash, decrypts, checks the content hash, and rejects the PDF if any step fails.

## Manifest

The manifest is JSON with a version `v`; a reader refuses a value it does not know, and drops unknown or mistyped fields. It holds the folder name and, per paper, its bibliographic metadata, its `bib.bib`, optionally annotations, and the PDF as a list of parts. It never holds `status`, `tags`, `notes` or `files`, which are the sharer's own.

A blob cannot exceed the KV value limit. A larger PDF is split into parts of plaintext; part sizes sum to the PDF size.

## Deck

A deck is shared through the same link format, Worker paths and part blobs as a folder; only its manifest differs.

- **Manifest**: JSON `{v: 1, kind: "deck", title, deck: "talk" | "poster", size, bytes, parts: [{blob, content, size}]}`. `size` is the deck's `data-deck-size` and must be allowed for its kind, `bytes` is the UTF-8 size of the deck's single-file HTML, and part sizes sum to it. A reader refuses any other value and drops unknown fields.
- **Encryption**: AES-GCM key derived by HKDF-SHA256 from the link key with an empty salt and the info label `labshelf-share-deck-manifest`, sealed as one frame bound to the share id with doc key `manifest` and frame kind `share-deck-manifest`. The label and kind are frozen like the paper ones. Key and frame kind differ from the paper manifest's, so neither opens as the other.
- **Parts**: the HTML's UTF-8 bytes in parts of at most the paper part size, each a convergent blob as PDF parts are, so the same HTML is the same blobs in every share.
- **Opening**: a reader tries the paper manifest first, then the deck manifest. A viewer from before decks opens only the paper manifest and shows its damaged-link message for a deck link (accepted).
- The share list entry has `kind: "deck"` and the deck's title as its folder; revoking works as for a folder.
- **Hosts**: `ShareHost.shareDeck` shares a deck's single-file HTML, and `ShareLinkView.kind` (`"deck"`, absent for a folder) tells the lists apart. Insert QR takes the newest (by creation time) deck link whose folder is the deck's title, and offers to share first when there is none.
- **Viewer**: the share page loads the deck viewer as a lazy chunk and shows the HTML in a sandboxed frame (`allow-scripts` only, no same-origin access), with Present for talks and Download HTML.

## Worker endpoints

Served by the owner's Worker, as raw bytes with CORS for any origin. They carry no version of their own.

- `GET /share/<id>/manifest` and `GET /share/<id>/blob/<hash>` are public. A blob reads `404` when the share's manifest is missing, so a revoked link reads nothing.
- Everything else needs the owner secret as bearer: `HEAD` on a blob, `PUT` of a blob (its body hash must be `<hash>`) and of the manifest, and `DELETE` of either, which succeeds also when absent.
- KV keys are `share:<id>:manifest` and `blob:<hash>`. Blobs are shared between the owner's shares without reference counts.

## Upload and revoke

- Upload lists the share in the share list first, so anything that reaches the Worker can be revoked. Then it puts missing blobs, then the manifest, so a link never names a missing blob. A failed upload revokes what it wrote.
- Revoke deletes the manifest first (the link ends once KV edge copies expire), then the blobs no other listed share names, then the list entry. The deletes are idempotent, so a failed revoke is finished by revoking again.
- The list is per device: a revoke may delete a blob that a share made on another device also uses, whose PDF then reads as missing.
- A share is written and revoked only through the relay account the device is connected to.

## Open in LabShelf

The share page's button opens `vscode://labshelf.labshelf/importShare?link=<percent-encoded link>`. `labshelf.labshelf` is the VS Code extension id. The extension parses the link and copies the papers into the library; the browser imports a pasted link the same way. Shared annotations are not imported.

## Share list

The device keeps its shares in `<state>/libraries/<key>/shares.json` ([device-local files](library-format.md#device-local-files)); in the browser the same text lives in the extension's local storage, never its synced storage. Each entry holds the share id, folder, relay URL, link key (so the device can show the link again), creation time, every blob the manifest names, and `kind: "deck"` for a [deck](#deck) (absent for a folder; a reader drops any other value). A file that is not this JSON stops upload and revoke, because overwriting it would lose shares the device can still revoke. Each change re-reads and writes inside an exclusive section: per process on the desktop (two VS Code windows are not serialized), a Web Lock per library in the browser.
