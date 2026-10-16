# Log: Find and download PDFs as well as Zotero and Paperpile

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. -->

- 2026-10-15 — Plan approved. Branch `feat/pdf-finding` cut from `feat/reader-ux` (72b3dc0); coordination C1–C4 recorded.
- 2026-10-15 — S2: `FetchOutcome` classifier in `download/fetchOutcome.ts`, `PdfMiss.needsLogin`; a navbar "Sign in" link on an HTML page with no candidate gave `login`.
- 2026-10-15 — S1: harness in `packages/core/tools/pdf-eval/`; baseline ids 34/66 (4 wrong), landing 35/66 (4 wrong), zero correct in chemistry/engineering and pre-1990; A2 re-based on this corpus.
- 2026-10-15 — S4: session 1 finish green; `eval:pdf` documented in `documents/apps/README.md`; ACM swapped for AIP in `closed.json`.
- 2026-10-15 — S3: harness baseline logged; the user's manual baseline skipped, reproducible from build 72b3dc0; S7 ends with a 3-paper Chrome check.
- 2026-10-15 — Follow-up plan google-search-capture (draft) puts the save button on Google results; it starts after session 3 because it reads the rule table.
- 2026-10-15 18:20 — Q1 changed by the user: manual checks (A7, A8, A11) run in Chrome and in Firefox, logged separately.
- 2026-10-15 21:20 — S5: two-stage engine in `engine/`; a candidate downloads once its lookup and every higher-ranked lookup answered; an attempt reports its most telling outcome; deadlines use plain timers.
- 2026-10-15 21:20 — S6: the DOI landing page is an engine lookup (`engine/landingLookup.ts`), not an `importIdentifier` step; background fetch cannot send a Referer without `declarativeNetRequest`.
- 2026-10-15 21:25 — S7 harness: ids 34/66 (3 wrong), landing 33/66 (4 wrong), not-found median 1.4 s; A3 met; session 2 finish green.
- 2026-10-15 22:20 — S8: rule table in `rules/`, every rule carries `examples` run by `ruleTable.test.ts`; landing rules apply to every HTML hop; per-rule paywall signatures dropped.
- 2026-10-15 22:20 — S9: 46 platforms (A4); MIT Press, Project Euclid and SPIE left out as unverified; Atypon and Wiley shapes verified only up to the Cloudflare wall.
- 2026-10-15 22:20 — S10: wall signatures in `download/wallSignatures.ts` matched on any status, final URL and headers; live and built fixtures; A5 met.
- 2026-10-15 22:20 — S11 harness: ids 33/66 (2 wrong), landing 33/66 (3 wrong); A2 not met because closed publishers wall Node (R4); supplement hops skipped, doi.org arXiv links counted as arXiv URLs.
- 2026-10-15 23:07 — S12: bot walls go to the helper tab at once (`engine/helperTabs.ts`), one tab per site, at most 2 sites; two PMC papers passed the proof-of-work in headless Chrome.
- 2026-10-15 23:07 — S13: `PdfMiss.access` drives "Open to sign in" / "Open to pass the check" (`ifNoPdf: "open"`); the 5-minute watch lives in `storage.session`; A8 waits for the user.
- 2026-10-15 23:07 — S14: session 4 finish green (core 2128, browser 138, vscode 255 tests); the user's closed checklist on 72b3dc0 and on this build is still to run.
- 2026-10-15 20:22 — S15: proxy rewrites (`access/proxyRewrite.ts`) and access stage (`access/accessStage.ts`) run only when the download stage found nothing; rules gain `openAccess`; A6 met.
- 2026-10-15 20:22 — S16: "Library proxies" options section; `settings.proxies` validated on read and passed to `findPaperPdf`; checked in headless Chrome.
- 2026-10-15 20:22 — S17: session 5 finish green (core 2152, browser 148 tests); A7 and the S14 A8 check still to run.
- 2026-10-15 20:41 — S18: `customResolver.ts` replaces `sciHub.ts`; "Custom resolvers" options section; `mirrorToCustomResolver` migration; A9 met.
- 2026-10-15 20:41 — S19: `titleTwin.ts` learner (arXiv title + surname, OpenAlex `autocomplete`) and old-style arXiv ids; the corpus has no title-only paper, so the harness does not exercise it.
- 2026-10-15 20:41 — S20 harness: ids 33/66 (2 wrong), landing 33/66 (3 wrong); A2 not met; A3 holds (found-time swings are network); finish green (core 2173, browser 159, terminal 863, vscode 255); a capture through a custom resolver is unchecked in a real browser.
- 2026-10-15 22:00 — C1: nothing to rebase onto; the `pdfVersion` contract change is in a commit of its own.
- 2026-10-15 22:00 — S21: `pdfVersion` in `model/pdfVersion.ts`, `candidateVersion.ts`, ranking by version, badge and "Find Published Version"; C2 lookup is `publishedDoiOf` in `registries/publishedDoi.ts`; A12 and A13 core parts met.
- 2026-10-15 22:00 — S22: `import/pdfMatch/matchPdfToPaper.ts` matches ids, then the page-1 title through `sameWork`, nothing on a tie; `extractDoi` keeps `&…` after a DOI in a query string.
- 2026-10-15 22:00 — S23: `background/pdfOffer/` watches downloads and PDF tabs, stages bytes in `labshelf-pdf-staging`, offscreen page-1 text in Chrome; checked in headless Chrome only.
- 2026-10-15 22:00 — S24 harness: ids 32/66, landing 27/66, drop against S20 is network; finish green (core 2266, browser 202, vscode 255, terminal 863); A11 and the manual parts of A12 and A13 wait for the user.
- 2026-10-15 22:25 — C1: nothing to rebase onto; `feat/writing-core` is unmerged and edits other sections of `library-format.md`.
- 2026-10-15 22:25 — S25: `import/landing/contacts/` adds `mailtoLinks` and `authorEmails` to `RawPage`; PubMed `pubMedAuthorsByDoi`; fixtures are snippets, not saved pages.
- 2026-10-15 22:25 — S26: `pdfRequestedAt` in contract, YAML and `updatePaperFields`; `requestCopyMailto` in English, Portuguese and Spanish with an 1,800-character cap.
- 2026-10-15 22:25 — S27: `paper.askAuthor { id }` runs in the background and opens the `mailto:` by navigating the tab; with no address the article page opens; mail-client hand-off unchecked.
- 2026-10-15 22:25 — S28: session 8 finish green (core 2340, browser 214, vscode 255, terminal 863); A2 unmet; the plan stays open for the user's manual checks.
- 2026-10-16 — Converted to the plan directory format; open items are A2, A7, A8, A11 and the manual parts of A12–A14 in session 9.
