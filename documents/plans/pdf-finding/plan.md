# Plan: Find and download PDFs as well as Zotero and Paperpile

Status: in progress (session 9 of 9) — all steps run; waiting for the user's manual checks (A7, A8, A11, and the manual parts of A12–A14)
Size: GG — a measurement harness, a reordered resolver engine, a publisher rule table, a bot-wall ladder, library proxies, PDF versions and two last-resort flows across core and the browser extension; grows past 9 sessions if the user's manual checks show session access failing for reasons the rules cannot fix
Pending decisions: 0

This plan uses the directory format. Read this file, then only `sessions/09.md`. `log.md` is append-only: add lines with `>>`, never read it whole.

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
- **Contracts touched:** [documents/contracts/library-format.md](../../contracts/library-format.md), two optional `metadata.yaml` keys: `pdfVersion` and `pdfRequestedAt` (written). Settings live in the browser's `storage.local`.

## 4. Acceptance criteria

Open only. Every other criterion (A1, A3–A6, A9, A10) is met and logged in [log.md](log.md).

- [ ] **A2** On the harness (`pnpm --filter @labshelf/core eval:pdf`), the "landing" scenario reaches at least 40/66 correct PDFs and "ids" at least 37/66, with at most 2 wrong PDFs. Latest run (S24): ids 32/66, 2 wrong; landing 27/66, 3 wrong, below the 33/66 of S11 and S20 because of network load, not code. The gap is closed publishers that bot-wall Node (R4), which only A7 measures.
- [ ] **A7** Manual, by the user, in Chrome and in Firefox while signed in through the institution: from the closed-access checklist (`packages/core/tools/pdf-eval/closed.json`, 15 papers), the toolbar popup attaches the correct PDF for at least 12 and the Google Scholar capture for at least 10. The user skipped the baseline; it stays reproducible from the `72b3dc0` build.
- [ ] **A8** Manual: when a capture ends in "PDF not found" because of a sign-in or bot wall, the dialog offers "Open to sign in" / "Open to pass the check". After the user signs in or solves it in that tab, the PDF attaches without another click.
- [ ] **A11** Manual: in Chrome and in Firefox, with a paper in the library that has no PDF, the user downloads its PDF from any site or opens it in a tab. The toolbar badge appears, the popup offers "Attach to <paper>", and one click attaches it. A PDF of an unrelated paper offers nothing.
- [ ] **A12** Manual part: for a paper whose only free copy is on arXiv, capture attaches it with `pdfVersion: preprint`, and the badge shows in the browser library and in VS Code. "Find PDF" on that paper asks before it replaces the file. (Unit tests pass.)
- [ ] **A13** Manual part: VS Code shows the "PDF requested from the author on <date>" line. (The YAML round trip passes in core tests.)
- [ ] **A14** Manual part: when a capture ends in "PDF not found" with an author address on the page, "Ask the author" opens the mail client with the subject, citation, DOI link and the requester's name and affiliation filled in, in Chrome and in Firefox. The detail pane then says "PDF requested from the author on <date>". (Address extraction, PubMed strings and `mailto:` encoding are unit-tested.)

## 5. Design

Finished pieces: core `import/pdfFinding/` (`engine/`, `download/`, `rules/`, `access/`, `resolvers/`), `import/pdfMatch/`, `import/landing/contacts/`, `library-ui/requestCopy/`, `model/pdfVersion.ts`; browser `capture/tab/` (helper and visible tabs), `background/pdfOffer/` (download and PDF-tab watcher), `options/`; the harness in `packages/core/tools/pdf-eval/`.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 9 | [sessions/09.md](sessions/09.md) | The user's manual checks, then the verdict on A2 and closing the plan | yes |

Sessions 1–8 are finished and logged. A failed manual check can add sessions; the Size line says when.

Runner tiers: **H** the session model (Opus or Fable); **M** Sonnet; **L** Haiku.

## 7. Risks

- **R1** Publishers change URLs and walls, so the rules decay — every rule has an example and a test, the harness flags drops, and the decay is a known cost.
- **R3** The visible-tab watcher attaches a wrong PDF (a supplement or another article) — the supplement URL filter, plus the `sameWork` check on the page's `citation_title` before attaching.
- **R4** Node results do not predict the browser — the user's closed checklist (A7) is the parity measure; the harness only guards open access and the rules.
- **R5** Chrome Web Store review flags the custom resolver — it ships generic, empty and off (D11).
- **R6** The download re-fetch fails for one-time signed URLs (for example ScienceDirect's `pdf.sciencedirectassets.com`) — the id match still works without bytes; the popup then offers "Attach PDF…" with the paper preselected.
- **R7** Replacing a preprint with the published version breaks highlights anchored to the old pages — replacement always asks first and warns when notes exist (D14).

## 8. Log

See [log.md](log.md).
