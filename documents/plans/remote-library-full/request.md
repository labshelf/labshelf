# Request: remote library, one mode

Written for the agent that turns this into `plan.yaml` and session files (orchestrate skill, level N3) and for the sessions that run it. Decisions below were made with the user on 2026-11-10. It follows the closed remote-library plan (commit 0b885a5a0 on main): `/open/` already signs in with Cloudflare and lists papers from the Mirror; A1, A2 (data) and A4 passed by hand.

## Goal

From any computer, the user signs in at `https://labshelf.org/open/` and uses their LabShelf in the app's own interface: projects one's slides and posters, reads a note, checks a space's checklist or tasks, and edits LaTeX, Typst and notes, with Python and R cells running in the browser. There is one mode; what differs is only where the files are stored (Durable Object without a card, or R2 with a card) and whether paper PDFs are included.

## What is wrong today (from the hand check)

- `/open/` mounts the share viewer (`mountLibraryUi` alone): no sidebar, Home, Spaces, Projects or tabs; projects render as raw "Sources: <name>" lists above the table; the look differs from the app.
- Spaces, built project outputs (PDF) and paper PDFs are not mirrored.
- The Mirror Durable Object lives inside the relay Worker, so a relay rotation deletes it and the next sync re-uploads everything.
- A row value is capped at 2 MB and a request at 1 MiB; files over 1 MiB are skipped.
- The Account tab does not say which Cloudflare account (email) is connected.

## Decisions

- R1 One mode. No "simple" and "advanced". Every feature below works on the Durable Object store; R2 only adds space.
- R2 Store survives rotation: the `Mirror` Durable Object class moves to a stable, never-rotated script (the existing share Worker, or a new stable script if that is cleaner), deployed with `workers_dev: false` if it needs no public URL. The rotating relay binds `MIRROR` with `class_name: "Mirror", script_name: <stable script>` and keeps serving `/mirror/*`, so `/open/` and the directory do not change. Verified live on 2026-11-10 on the user's Free account: a Worker bound by `script_name` read and wrote a SQLite DO of another script, the store script had `workers_dev: false`, and the data survived deleting the binding Worker and deploying a new one under another name. Consequences to plan: the `Mirror` migration moves to the stable script; the relay's `RELAY_MIGRATIONS` drop it with a `deleted_classes` (or transfer) step for relays that already have v3; the stable script is deployed and migrated before the relay binds to it; `deleteWorker(force=true)` must never target it; existing mirrors re-upload once.
- R3 Row size: values up to 8 MB per row (Cloudflare's documented DO SQLite row limit; a 7 MiB row was written and read back live). Use a safety margin (chunks of 7 MiB) and keep chunking for larger files. Raise the 1 MiB per-request and per-file caps accordingly (request bodies may be up to 100 MB on Free); budget requests per D10 of the old plan.
- R4 Storage and the Account tab: the Account tab shows the connected Cloudflare email ("Connected as <email>, with your relay at <host>"), where the files are stored (Durable Object or R2), the space used, and the limit.
  - Durable Object (no card): the account's free SQLite DO storage is 5 GB. No charge is possible. When storage is full Cloudflare refuses writes; LabShelf stops sending, says "Your 5 GB are full. To store more, move to R2 (needs a card on your Cloudflare account)" and lists what was left out. Warn before (for example at 90%).
  - R2 (card on file): 10 GB free, then billed. To avoid a silent bill, LabShelf stops sending at 9 GB by default and warns before; the user reactivates by hand or sets a new limit, which LabShelf respects. Also watch R2 operations (1M Class A free per month) so no bill comes from that side. Moving between DO and R2 is an explicit action in the Account tab.
- R5 What is mirrored: paper metadata and notes, project sources, built project outputs (compiled PDF of LaTeX/Typst, deck single-file HTML) ready to present, space files (checklists, tasks, discussions; check the format in code), and project assets needed to edit and compile (images, figures, .bib, .sty). Paper PDFs only when the user turns on "Include paper PDFs" (off by default), with the space it will use shown first.
- R6 `/open/` uses the app's interface: the browser extension's library page shell (sidebar with Home, Spaces, Projects; editor-area tabs; project tree; notes; deck viewer with Present full screen; PDF viewer for built outputs and, when included, paper PDFs), served by a host over the Mirror instead of the local folder. It must look like the app, not the share page.
- R7 Editing on `/open/`: notes, checklists, LaTeX and Typst sources can be edited. Edits must reach the home computer's library folder without conflicts. First choice to research: reuse the existing project collaboration (Yjs rooms on the relay, end-to-end encrypted) so `/open/` joins the owner's projects like another device; otherwise a write-back queue in the Mirror that the apps apply on sync, with conflict copies. The research decides; editing papers' metadata is out of scope.
- R8 Compiling in the browser: Typst through its WASM compiler; LaTeX through a WASM engine (busytex or SwiftLaTeX; Tectonic does not run in a Worker) marked experimental, with a clear error for missing packages. Compiling on Cloudflare is out: a Worker cannot run Tectonic (CPU time, size, native code), and Containers need a paid plan.
- R9 Running cells in the browser: Python through Pyodide and R through WebR, loaded on demand. Always show that it is a reduced version: slower, fewer libraries, no access to the home computer's packages or files. Other languages show that they run only on the home computer. Saved outputs always display.
- R10 Security stays as accepted before: the Mirror stores plaintext in the owner's account, protected by the Cloudflare login; the docs recommend Cloudflare two-factor. Editing adds writes from `/open/`, so the session token must authorize writes only for the owner's session.

## Open questions for the planning research

- Whether the share Worker exists for every user who connects Cloudflare, or only after a first share; pick the stable script accordingly.
- Space file format and where spaces live (`spaces/**`), and which files a space needs to render read-only and to edit checklists.
- Where built outputs are written (VS Code and browser), and how to find the latest build per project.
- Whether the browser extension already runs cells or compiles Typst/LaTeX without a helper (`documents/plans/browser-latex-helper`, `multi-language-cells`), to reuse it on `/open/`.
- How the library page shell can be mounted outside the extension (its ports and host), as the share page does with `mountLibraryUi`.
- R2 API from the app: create a bucket, bind it to the stable script, and the OAuth scope it needs (the current client has workers-scripts.admin, workers-kv-storage.write, account-analytics.read, account-settings.read, user-details.read, offline_access); whether enabling R2 can be detected (card on file) through the API.
- How to read the DO storage used per account (GraphQL analytics) for the Account tab and the 90% warning.

## Acceptance (by hand at the end)

- B1 On a university computer, `/open/` shows the app's sidebar with Home, Spaces and Projects; a talk opens and Present goes full screen; a poster's built PDF opens.
- B2 A space's checklist and tasks show, and ticking an item on `/open/` appears in VS Code after the next sync.
- B3 Editing a `.tex` file on `/open/` and compiling shows the PDF; the edit reaches the home folder with no conflict copy.
- B4 A Python cell runs on `/open/` with the reduced-version notice; an R cell too.
- B5 A relay rotation keeps the mirror: `/open/` shows the library right after, with no re-upload.
- B6 The Account tab shows the connected email, the store (DO or R2), the space used and the limit; turning on Include paper PDFs shows the space first, and a paper's PDF opens on `/open/`.
- B7 With a small test limit, reaching it stops sending and shows the message; raising the limit resumes.
