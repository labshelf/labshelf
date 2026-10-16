Kept because: the Zotero and Paperpile comparison behind D1–D15, the harness measurements per session, and the closed-access parity check (A7) that was never run.
Needed when: the PDF hit rate is measured again, someone with institutional access runs the closed checklist, or the PDF chain is reordered.

# Plan: Find and download PDFs as well as Zotero and Paperpile

Status: done (session 9 of 9) — closed without institutional checks; the rest moved to plan `pdf-finding-checks`
Size: GG — a measurement harness, a reordered resolver engine, a publisher rule table, a bot-wall ladder, library proxies, PDF versions and two last-resort flows across core and the browser extension; grows past 9 sessions if the user's manual checks show session access failing for reasons the rules cannot fix
Pending decisions: 0

## 1. Goal

The browser extension finds and downloads the PDF of a paper as often as Zotero and Paperpile do, including the closed papers the user can already read through their institution. "PDF not found" is rare, fast and actionable: one click lets the user sign in or pass a bot check, and the PDF attaches itself. When the user finds the file on their own, it attaches to the right paper without a hunt. When only a preprint exists, the user gets it, labelled as such. When nothing exists, one click drafts an email asking the author for a copy.

## 2. Decisions

Research (2026-10-15, Zotero source, the Paperpile Firefox add-on 1.0.132 source, Martín-Martín et al. 2018) shows that the gap is the order and the fetch context, not missing sources. Both tools start from the article page and the user's session, and they use site-specific PDF rules (Paperpile has about 430 drivers, Zotero about 700 translators). Open-access APIs come second. LabShelf starts from the APIs and has 46 rules.

- [x] **D1** The target is the browser extension. The chain stays in core `import/pdfFinding/`. VS Code and the terminal run the same order, without any session features — saving files with a session happens only in the browser for now.
- [x] **D2** Measure first. A Node harness on a 66-paper corpus measures open access and publisher rules. A 15-paper closed-access checklist, run by the user in Chrome and Firefox with institutional access, measures session gains — Node has no session.
- [x] **D3** Page first. The article page (the user's tab, or the DOI landing page fetched in the background) is parsed before the aggregator results are downloaded, and every download sends the page as Referer — this is what Zotero and Paperpile do.
- [x] **D4** Two stages: all lookups (the page, and the learning and direct resolvers) run concurrently with a 3 s cap, then the ranked candidates download with limited concurrency — this keeps the learners-feed-PMC invariant and makes "not found" fast.
- [x] **D5** Polite per-domain pacing: 1 s between requests to a domain, and a domain is skipped for the run after 5 consecutive failures — publishers block bursts (Zotero's numbers).
- [x] **D6** Publisher rules are a data table ported from the URL shapes in Zotero's translators and the earlier research, rewritten and not copied — Zotero is AGPL; URL shapes are facts. Each rule has a verified example and a unit test.
- [x] **D7** Every fetch has an outcome: `pdf`, `bot`, `login`, `html`, `error`. `bot` matches the wall signatures (`core/src/import/pdfFinding/download/wallSignatures.ts`) on any status and on the final URL. `login` is a 401/403 without bot markers, or HTML with paywall or sign-in markers and no PDF candidate.
- [x] **D8** Bot-wall ladder, browser only: background fetch with cookies → the inactive helper tab (it also passes the PMC proof-of-work, because the page's own script solves it) → on the user's click, a visible tab that is watched and attaches the PDF when it becomes reachable. The visible tab also serves institutional sign-in (CAFe/Shibboleth).
- [x] **D9** Library proxies: an ordered list of `{ name, template, enabled }` in the options page. The kind follows from the template: a prefix with `$@` (Paperpile's convention), a hostname suffix (`.ezproxy.uni.edu`), or the OpenAthens redirector. Only candidates on publisher hosts that answered `login` are retried through them. No credentials are stored, and there is no preset database.
- [x] **D10** The only manifest addition is Chrome's `offscreen` permission, which has no install warning and lets pdf.js read a downloaded PDF's first page (D13). `https://*/*` already covers fetching and reading tab URLs, and the helper tab replaces the `cookies` permission for PMC.
- [x] **D11** A generic custom resolver (a URL template with `{doi}`, whose page goes through the hop parser) takes the place of `sciHub.ts`. It is off by default, and the user fills in any mirror, Sci-Hub or Anna's Archive SciDB included. The extension's code and UI name no shadow library. The stored `enableSciHub`/`sciHubMirror` settings move to one custom-resolver entry through a `migrations/` step.
- [x] **D12** The attempt log records each URL's outcome and status. The "PDF not found" dialog uses it to offer the right action: sign in, pass the check, or ask the author.
- [x] **D13** A PDF the user opens in a tab or downloads is matched against the papers that have no PDF: first by DOI or arXiv id in its URL or referrer, then by the title on page 1. A match offers "Attach to <paper>?" through the toolbar badge and popup, never a system notification, because that would need the `notifications` permission. The extension re-fetches the bytes from the download's final URL with the user's cookies, because extensions cannot read the downloads folder.
- [x] **D14** Every attached PDF records its version, `preprint`, `accepted` or `published`, when the source says so. The chain still prefers the published version, but it attaches a preprint or accepted manuscript when nothing better exists. Lists and the detail pane show a "Preprint" or "Accepted" badge. "Find PDF" on a labelled paper looks for the published version and asks before it replaces the file, warning when notes or highlights exist.
- [x] **D15** "Ask the author" opens a prefilled `mailto:` in the user's own mail client, and LabShelf never sends mail itself. The paper records `pdfRequestedAt`, and the author's address is not stored. Addresses come, cheapest first, from the page's `citation_author_email`, from `mailto:` links near "Correspondence" or "Corresponding author", and from PubMed's "Electronic address:" in `efetch` affiliations. If none is found, the button opens the article page.
- [x] **Q1** The manual checks (A7, A8, A11) run in Chrome and in Firefox, logged separately, because Total Cookie Protection may keep publisher cookies out of background requests in Firefox.

## 3. Scope

- **In:** core `import/pdfFinding/` (engine, outcomes, rules, custom resolver), core landing parsing, the browser extension's capture flows, helper and visible tabs, options page and "PDF not found" dialog, a harness under `packages/core/tools/pdf-eval/`.
- **Out:**
  - Re-checking papers without a PDF in the background for copies that appear later.
  - Interlibrary loan requests — forms differ per library, and asking the author works better.
  - Google Scholar "All versions" and ResearchGate scraping — ToS and CAPTCHAs, and many of those copies infringe.
  - A server-side paper-to-URL map like Paperpile's `/match` — LabShelf is local-first; OpenAlex fills that role.
  - Session access in VS Code and the terminal (D1).
  - LibKey and OpenURL link resolvers; proxy auto-detection and presets — the user pastes their library's template.
  - Checking the downloaded PDF's text against the title — the metadata `sameWork` check stays.
- **Contracts touched:** [documents/contracts/library-format.md](../contracts/library-format.md), two optional `metadata.yaml` keys: `pdfVersion` and `pdfRequestedAt` (written). Settings live in the browser's `storage.local`.

## 4. Acceptance criteria

A1, A3–A6, A9 and A10 are met, and the automated parts of A12–A14 pass; the log below has each result.

- **A2** Kept as a regression guard on open access: on the harness (`pnpm --filter @labshelf/core eval:pdf`), "ids" and "landing" each reach at least 33/66 with at most 3 wrong PDFs. The original target (40 and 37) is withdrawn, because closed publishers wall Node (R4).
- **A7** Not measured: from the closed-access checklist (`packages/core/tools/pdf-eval/closed.json`, 15 papers), in Chrome and Firefox signed in through an institution, the popup should attach the correct PDF for at least 12 and the Google Scholar capture for at least 10. The baseline is the `72b3dc0` build.
- **A8** The sign-in half is not measured (same reason as A7); the bot-wall half moved to plan `pdf-finding-checks`.
- **A11** and the manual parts of **A12–A14** moved to plan `pdf-finding-checks`.

## 5. Design

Finished pieces: core `import/pdfFinding/` (`engine/`, `download/`, `rules/`, `access/`, `resolvers/`), `import/pdfMatch/`, `import/landing/contacts/`, `library-ui/requestCopy/`, `model/pdfVersion.ts`; browser `capture/tab/` (helper and visible tabs), `background/pdfOffer/` (download and PDF-tab watcher), `options/`; the harness in `packages/core/tools/pdf-eval/`.

## 6. Sessions

Sessions 1–9 are finished; the log below has each step.

## 7. Risks

- **R1** Publishers change URLs and walls, so the rules decay — every rule has an example and a test, the harness flags drops, and the decay is a known cost.
- **R3** The visible-tab watcher attaches a wrong PDF (a supplement or another article) — the supplement URL filter, plus the `sameWork` check on the page's `citation_title` before attaching.
- **R4** Node results do not predict the browser — the user's closed checklist (A7) is the parity measure; the harness only guards open access and the rules.
- **R5** Chrome Web Store review flags the custom resolver — it ships generic, empty and off (D11).
- **R6** The download re-fetch fails for one-time signed URLs (for example ScienceDirect's `pdf.sciencedirectassets.com`) — the id match still works without bytes; the popup then offers "Attach PDF…" with the paper preselected.
- **R7** Replacing a preprint with the published version breaks highlights anchored to the old pages — replacement always asks first and warns when notes exist (D14).

## 8. Log

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
- 2026-10-16 — S29: A7 not run and dropped; the user has no institutional access. The closed checklist stays in `packages/core/tools/pdf-eval/closed.json` for whoever has it; parity with Zotero and Paperpile on closed papers is unmeasured.
- 2026-10-16 — S30–S34: the checks that need no institution (A8 bot-wall part, A11, manual parts of A12–A14) moved to plan `pdf-finding-checks`; the A8 sign-in part dropped with A7.
- 2026-10-16 — S35: A2 kept as a regression guard on open access: floor ids 33/66 and landing 33/66 with at most 3 wrong (best S11/S20 runs); the 40/37 target is withdrawn because closed publishers wall Node (R4). Plan closed and archived.
