# Request: remote library, one mode

Written for the agent that turns this into `plan.yaml` and session files (orchestrate skill, level N3) and for the sessions that run it. Decisions below were made with the user on 2026-11-10. It follows the closed remote-library plan (commit 0b885a5a0 on main): `/open/` already signs in with Cloudflare and lists papers from the Mirror; A1, A2 (data) and A4 passed by hand.

## Goal

From any computer, the user signs in at `https://labshelf.org/open/` and uses their LabShelf in the app's own interface: projects one's slides and posters, reads a note, checks a space's checklist or tasks, and edits LaTeX, Typst and notes, with Python and R cells running in the browser. There is one mode; what differs is only where the files are stored (Durable Object without a card, or R2 with a card) and whether paper PDFs are included.

## Already built (main, commit 4f0c825a1 "Open the remote library in the LabShelf interface")

- `/open/` shows the app's sidebar, tabs, Home, Projects and Spaces, read-only (`website/src/open/`: openWorkspace, mirrorFileSystem, mirrorProjects, fileTabs).
- The Mirror copies Spaces, `home.json`, `labshelf.yaml` and compiled project PDFs (up to 20 MiB, in base64 parts under the 1 MiB request limit; `packages/core/src/remoteLibrary/mirrorOutput.ts`). PDFs and decks open ready to present; paper notes open full screen.
- Core has read-only options for serveSpaces, the Spaces catalog and the sidebar Spaces section.

This plan builds on that and does not redo it.

## What is still missing

- Everything on `/open/` is read-only: no editing, compiling or running cells.
- Paper PDFs are not mirrored, even as an option.
- The Mirror Durable Object lives inside the relay Worker, so a relay rotation deletes it and the next sync re-uploads everything.
- Rows are capped at 2 MB and requests at 1 MiB, so large outputs travel as many base64 parts (about 33% larger).
- No storage accounting or limits; no R2.
- The Account tab does not say which Cloudflare account (email) is connected.

## Decisions

- R1 One mode. No "simple" and "advanced". Every feature below works on the Durable Object store; R2 only adds space.
- R2 Store survives rotation: the `Mirror` Durable Object class moves to a stable, never-rotated script (the existing share Worker, or a new stable script if that is cleaner), deployed with `workers_dev: false` if it needs no public URL. The rotating relay binds `MIRROR` with `class_name: "Mirror", script_name: <stable script>` and keeps serving `/mirror/*`, so `/open/` and the directory do not change. Verified live on 2026-11-10 on the user's Free account: a Worker bound by `script_name` read and wrote a SQLite DO of another script, the store script had `workers_dev: false`, and the data survived deleting the binding Worker and deploying a new one under another name. Consequences to plan: the `Mirror` migration moves to the stable script; the relay's `RELAY_MIGRATIONS` drop it with a `deleted_classes` (or transfer) step for relays that already have v3; the stable script is deployed and migrated before the relay binds to it; `deleteWorker(force=true)` must never target it; existing mirrors re-upload once.
- R3 Row size: values up to 8 MB per row (Cloudflare's documented DO SQLite row limit; a 7 MiB row was written and read back live). Use a safety margin (chunks of 7 MiB) and keep chunking for larger files. Raise the 1 MiB per-request and per-file caps accordingly (request bodies may be up to 100 MB on Free); budget requests per D10 of the old plan.
- R4 Storage and the Account tab: the Account tab shows the connected Cloudflare email ("Connected as <email>, with your relay at <host>"), where the files are stored (Durable Object or R2), the space used, and the limit.
  - Durable Object (no card): the account's free SQLite DO storage is 5 GB. No charge is possible. When storage is full Cloudflare refuses writes; LabShelf stops sending, says "Your 5 GB are full. To store more, move to R2 (needs a card on your Cloudflare account)" and lists what was left out. Warn before (for example at 90%).
  - R2 (card on file): 10 GB free, then billed. To avoid a silent bill, LabShelf stops sending at 9 GB by default and warns before; the user reactivates by hand or sets a new limit, which LabShelf respects. Also watch R2 operations (1M Class A free per month) so no bill comes from that side. Moving between DO and R2 is an explicit action in the Account tab.
- R5 What is mirrored, beyond what main already copies: project assets needed to edit and compile (images, figures, .bib, .sty, .cls), and paper PDFs only when the user turns on "Include paper PDFs" (off by default), with the space it will use shown first. With R3, compiled outputs move from base64 parts to binary chunks of up to 7 MiB, and the 20 MiB output cap is revisited against the storage limits of R4.
- R6 `/open/` keeps the app interface main built; it gains the PDF viewer for paper PDFs when included, and the editing, compiling and cell surfaces of R7-R9 in place of the read-only ones.
- R7 Editing on `/open/`: notes, checklists, LaTeX and Typst sources can be edited. Edits must reach the home computer's library folder without conflicts. First choice to research: reuse the existing project collaboration (Yjs rooms on the relay, end-to-end encrypted) so `/open/` joins the owner's projects like another device; otherwise a write-back queue in the Mirror that the apps apply on sync, with conflict copies. The research decides; editing papers' metadata is out of scope.
- R8 Compiling in the browser: Typst through its WASM compiler; LaTeX through a WASM engine (busytex or SwiftLaTeX; Tectonic does not run in a Worker) marked experimental, with a clear error for missing packages. Compiling on Cloudflare is out: a Worker cannot run Tectonic (CPU time, size, native code), and Containers need a paid plan.
- R9 Running cells in the browser: Python through Pyodide and R through WebR, loaded on demand. Always show that it is a reduced version: slower, fewer libraries, no access to the home computer's packages or files. Other languages show that they run only on the home computer. Saved outputs always display.
- R10 Security stays as accepted before: the Mirror stores plaintext in the owner's account, protected by the Cloudflare login; the docs recommend Cloudflare two-factor. Editing adds writes from `/open/`, so the session token must authorize writes only for the owner's session.

## Open questions for the planning research

- Whether the share Worker exists for every user who connects Cloudflare, or only after a first share; pick the stable script accordingly.
- Which space files must be written back to edit a checklist or task (spaces already render read-only on `/open/`).
- Whether the browser extension already runs cells or compiles Typst/LaTeX without a helper (`documents/plans/browser-latex-helper`, `multi-language-cells`), to reuse it on `/open/`.
- R2 API from the app: create a bucket, bind it to the stable script, and the OAuth scope it needs (the current client has workers-scripts.admin, workers-kv-storage.write, account-analytics.read, account-settings.read, user-details.read, offline_access); whether enabling R2 can be detected (card on file) through the API.
- How to read the DO storage used per account (GraphQL analytics) for the Account tab and the 90% warning.

## Acceptance (by hand at the end)

- B2 A space's checklist and tasks show, and ticking an item on `/open/` appears in VS Code after the next sync.
- B3 Editing a `.tex` file on `/open/` and compiling shows the PDF; the edit reaches the home folder with no conflict copy.
- B4 A Python cell runs on `/open/` with the reduced-version notice; an R cell too.
- B5 A relay rotation keeps the mirror: `/open/` shows the library right after, with no re-upload.
- B6 The Account tab shows the connected email, the store (DO or R2), the space used and the limit; turning on Include paper PDFs shows the space first, and a paper's PDF opens on `/open/`.
- B7 With a small test limit, reaching it stops sending and shows the message; raising the limit resumes.

## Status (2026-11-10)

Built, per decision:

- R1 One mode: one set of features on the Durable Object store; R2 only adds space.
- R2 The `Mirror` class moved to the share Worker (`SHARE_MIGRATIONS` tag `v1`); the relay binds it by `script_name` and drops its old class with `RELAY_MIGRATIONS` `v4`. Connect and the start-up update deploy the share Worker first. Protocol minor 3, build 2.3.0.
- R3 Rows up to 7 MiB chunks; `PUT /mirror/file` takes up to 64 MiB, JSON batches up to 8 MiB.
- R4 The Account tab shows the email, the store, used and limit, the 90% warning, the full messages with what was left out, the limit field and Move to R2 / Durable Object. Default limits 5 GB (DO) and 9 GB (R2), 900 000 R2 operations a month.
- R5 Project assets, outputs as one binary row and, with Include paper PDFs (off, size shown first), paper PDFs; 64 MiB per file; the base64 parts format is gone.
- R6 `/open/` keeps main's interface, with a PDF tab for paper PDFs and the editing, compile and cell surfaces.
- R7 Editing through a write-back queue in the Mirror (`/mirror/edit`, `/mirror/edits`, ack) applied by the hosts every sync and every 60 s, with conflict copies; the Yjs rooms were not reused. Paper metadata stays read-only; trash, rename and removal of Spaces stay refused.
- R8 Typst compiles in the browser; LaTeX compiles with texlyre-busytex 1.4.1 (pdflatex) under the Experimental notice, its files in the `labshelf-assets` R2 bucket served by the website Worker at `/busytex/1.4.1/`. Not live until the bucket exists and `website/tools/uploadBusytex.mjs` has uploaded them.
- R9 Python (Pyodide 314.0.7) and R (WebR 0.6.1) cells with the reduced-version notice; other languages say they run only on the computer.
- R10 Plaintext in the owner's account as before; a session is minted only for the stored owner email and authorizes the page's reads and edits.

Remains:

- LaTeX engine hosting: SwiftLaTeX's servers are down and busytex needs 120+ MB hosted somewhere versioned.
- B2-B7 are to check by hand.
- The R2 bucket `labshelf-mirror` is created by hand in the Cloudflare dashboard (the OAuth client cannot request an R2 scope).
- Account-wide Durable Object usage is approximated by the Mirror's own rows.
