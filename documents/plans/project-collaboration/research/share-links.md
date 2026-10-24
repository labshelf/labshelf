sha: 3159f508
files: website/**, documents/architecture.md (website line), packages/core/src/library/**
source: decisions with the user, 2026-10-17; website/package.json, documents/apps/verify.md#website

# Paper-folder share links

- The repo has a static site: `website/` (`@labshelf/website`, workspace member, esbuild build into `website/dist/`). It already mounts core's library UI and reader through their host contracts over an in-page host (`documents/architecture.md`). The share page is one more page there: an in-page read-only host over the share data.
- Where the site is served is not in the repo (no workflow found); the origin is one constant, decided in session 8 (D17).
- Flow: the user picks a folder → "Share Folder as Link…" → chooses with or without annotations → LabShelf uploads copies to the owner's Worker KV and shows the link. Notice before upload: the sharer is responsible for the right to share the PDFs.
- KV layout: `share:<id>:manifest` (folder name, papers: metadata, sidecar if chosen, blob hashes) and `blob:<sha256>` (PDF, ≤25 MiB; larger PDFs are split into 20 MiB parts listed in the manifest). Shares reuse blobs by hash.
- Link (contract, `documents/contracts/share-link.md`): `<site>/share/#<worker host>/<share id>/<key>`. The fragment never reaches a server. `<key>` decrypts manifest and blobs in the page (WebCrypto AES-GCM), so the owner's account holds only ciphertext.
- The Worker serves `GET /share/<id>/…` with CORS `*`, read-only, no auth; uploads need the owner secret.
- Page: folder list and reader, read-only, no sign-in; "Install LabShelf", "Open in LabShelf" (a `labshelf:` link or the browser extension imports the papers into the library), "Download" (PDF or zip).
- Revoke = delete the manifest and unreferenced blobs; the page shows "This link was removed". A list of the user's shares lives device-local in the state dir.
- Scale: 20 papers to 100 students ≈ 20 writes once and ~2,000 reads/day; free limits are 1,000 writes and 100k reads/day.
