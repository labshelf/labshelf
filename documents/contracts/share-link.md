# Contract: share links

Read when you change how a folder of papers is shared as a link, what the owner's Worker stores for it, or how the share page opens it.

A *share link* gives anyone who has it a read-only copy of a folder of papers: their metadata, BibTeX, PDFs and, when the sharer chose so, their annotations. LabShelf uploads the copies, encrypted, to the owner's [relay Worker](relay.md); the share page of the LabShelf site decrypts them in the browser. The owner's account holds only ciphertext. Core's `share` module is the one implementation, and every app and the site use it: its workflows share a folder, revoke a share and import a link, and also hold the words the apps show, so an app adds only its pickers, dialogs, progress and clipboard.

## Link

```
<page origin>/share/#<worker host>/<share id>/<link key>
```

- The page origin is `https://labshelf.org`, one constant in core.
- The worker host is the host of the owner's Worker URL (`<worker>.<subdomain>.workers.dev`), without scheme, port or path; the Worker is reached at `https://<worker host>`.
- The share id is 16 random bytes as 32 lowercase hex characters. It is not derived from the link key, so the Worker's paths and KV keys reveal nothing about the key.
- The link key is 16 random bytes, base64url without padding (22 characters).
- Everything after `#` is the fragment, which a browser never sends to a server. An app accepts a link of any origin whose path ends in `/share/`, percent-decodes the fragment first (an opener such as VS Code may encode its slashes), and rejects it, naming the reason, when the fragment does not have exactly these three parts or a part is malformed.

## Encryption

- **Manifest.** The manifest key is HKDF-SHA-256 over the link key, with an empty salt and `info` `labshelf-share-manifest`, as an AES-GCM-256 key. The manifest's UTF-8 JSON is sealed as one [frame](collaboration.md#frame) with the share id, doc key `manifest` and payload kind `share-manifest`.
- **Blobs.** A PDF is stored as one or more parts. Each part is encrypted convergently: its *content hash* is the SHA-256 of the part's plaintext; HKDF-SHA-256 over those 32 bytes, with an empty salt and `info` `labshelf-share-blob`, gives 44 bytes, the AES-GCM-256 key (bytes 0–31) and the nonce (bytes 32–43). The stored blob is `version (1 byte, 1) | AES-GCM ciphertext and 16-byte tag`, without additional data. The blob hash is the SHA-256 of the stored bytes, 64 lowercase hex characters.
- One key seals only one plaintext, so the derived nonce is never reused with another plaintext.
- Convergent encryption makes the same PDF the same blob in every share, so shares reuse blobs and upload each PDF once. The trade-off: whoever can read the KV namespace learns that two shares hold the same PDF, and can confirm a guess of a PDF's exact bytes. That reader is the owner's Cloudflare account, which belongs to the sharer, who has the PDFs anyway.
- Only the manifest names the content hashes, and only the link key opens the manifest, so the blobs stay unreadable without the link.
- A reader checks that a fetched blob's SHA-256 is its blob hash, opens it, and checks that the plaintext's SHA-256 is its content hash. A part that fails any check is rejected, and the PDF is not shown.

## Manifest

```json
{
  "v": 1,
  "folder": "Reading group",
  "papers": [
    {
      "metadata": { "id": "vaswani2017attention", "title": "Attention Is All You Need", "citeKey": "vaswani2017attention",
                    "authors": ["Ashish Vaswani"], "year": 2017, "doi": "10.48550/arXiv.1706.03762" },
      "bib": "@article{vaswani2017attention, …}",
      "annotations": [ { "id": "…", "paperId": "vaswani2017attention", "type": "highlight", "pageNumber": 3, "…": "…" } ],
      "pdf": { "size": 2215244, "parts": [ { "blob": "<blob hash>", "content": "<content hash>", "size": 2215244 } ] }
    }
  ]
}
```

- `v` is the manifest format, `1`. A reader refuses another value.
- `folder` is the name of the shared folder.
- `metadata` holds the paper's id, `title`, `citeKey` and the bibliographic fields of a paper record: `authors`, `year`, `summary`, `journal`, `publisher`, `volume`, `issue`, `pages`, `doi`, `url`, `issn`, `language`, `keywords`. The user's own fields (`status`, `tags`, `note`, `files`) are never shared. A reader drops unknown keys and fields of the wrong type.
- `bib` is the paper's `bib.bib` text, when it has one.
- `annotations` is the `annotations` list of the paper's [sidecar](library-format.md#sidecar-datajson), present only when the sharer chose to share annotations. The theme and the reading position are never shared.
- `pdf` is absent for a paper without a PDF. Its parts are in order; their sizes are plaintext sizes and add up to `size`.
- A PDF whose stored blob fits 25 MiB, the KV value limit, is one part. A larger PDF is split into parts of 20 MiB of plaintext, the last one shorter.

## Worker endpoints

The owner's Worker serves shares from protocol `1.1` of the [relay](relay.md#versions); a Worker of `1.0` answers these paths with `404`. A share id is 32 lowercase hex characters and a blob hash 64. Successful bodies are the raw stored bytes, `application/octet-stream`, and carry no version. Every endpoint answers a CORS preflight and allows any origin.

| Request | Auth | Answer |
|---|---|---|
| `GET /share/<id>/manifest` | public | `200` the sealed manifest |
| `GET /share/<id>/blob/<hash>` | public | `200` the blob; `404` when the blob or the share's manifest is missing, so a revoked link reads nothing |
| `HEAD /share/<id>/blob/<hash>` | owner | `200` when the blob is stored, whatever the manifest; `404` otherwise |
| `PUT /share/<id>/blob/<hash>` | owner | `204`; the body's SHA-256 must be `<hash>` |
| `PUT /share/<id>/manifest` | owner | `204` |
| `DELETE /share/<id>/manifest` | owner | `204`, also when nothing is stored |
| `DELETE /share/<id>/blob/<hash>` | owner | `204`, also when nothing is stored |

- Owner requests carry `Authorization: Bearer <OWNER_SECRET>` (see [relay.md](relay.md#auth)).
- A refusal is a relay refusal `{v, error}`: `400 malformed` for a bad id or hash or a body whose hash does not match, `401 unauthorized` for a wrong owner secret, `404 notFound`, `413 tooLarge` for a body over 25 MiB.
- KV keys: `share:<id>:manifest` holds a sealed manifest and `blob:<hash>` a blob. Blobs are shared between the owner's shares; the Worker keeps no reference counts.

## Upload and revoke

- Upload writes the share to the device's [share list](#share-list) first, so whatever reaches the Worker can be revoked. It then puts every blob the Worker does not hold yet, and the manifest last, so a link never names a missing blob. A failed upload revokes what it wrote; if that fails too, the share stays listed for the user to revoke.
- Revoke deletes the manifest first, which ends the link once Cloudflare KV drops its edge copies (up to about 60 s), then every blob of the share that no other share in the list names, then removes the share from the list. A failure keeps the share listed; the deletes are idempotent, so revoking again finishes.
- The share list is per device. A blob that a share made on another device also uses is deleted by a revoke here, and that share's PDF reads as missing.
- A share is written and revoked only through the relay account the device is connected to; a share listed with another relay URL is refused, naming its host.
- The network calls run outside the share list's exclusive section (see [Share list](#share-list)). A share uploaded while a revoke deletes a blob it also names keeps a missing PDF; the revoke logs it.

## Open in LabShelf

The share page's Open in LabShelf button opens

```
vscode://labshelf.labshelf/importShare?link=<percent-encoded share link>
```

- `labshelf.labshelf` is the extension id, `<publisher>.<name>` of the VS Code extension's manifest, one constant in core beside the page origin.
- The link is the one [link](#link) form, written with the page origin constant whatever origin the page was served from.
- The extension's URI handler parses it with the same parser as any share link and copies the share's papers into the user's library; a link it cannot parse is refused with the parse error named.

## Share list

The shares a device made live in its state dir, outside the library: `<state dir>/libraries/<library key>/shares.json` (see [library-format.md](library-format.md#device-local-files)).

```json
{ "shares": [ { "id": "<share id>", "folder": "Reading group", "relayUrl": "https://labshelf-relay.example.workers.dev",
                "key": "<link key>", "createdAt": "2026-10-18T09:00:00.000Z", "blobs": ["<blob hash>"] } ] }
```

- `key` is the link key in base64url, so the device can show the link again. `blobs` lists every blob hash the share's manifest names.
- A missing file reads as no shares. A file that is not this JSON is never overwritten: upload and revoke stop with an error, since writing over it would lose the shares the device can still revoke. An entry with a malformed field is dropped. Every write is atomic.
- Every change of the list reads it again and writes it inside the store's exclusive section, so two pages or windows that add and remove shares at once keep both changes. A revoke removes only its own entry from the list as it is when the deletes finish. The desktop file store serializes the sections of one process; two VS Code windows over one library are not serialized against each other.
