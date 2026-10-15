# Plan: Find and download PDFs as well as Zotero and Paperpile

Status: in progress (session 5 of 8)
Size: GG — a measurement harness, a reordered resolver engine, a publisher rule table, a bot-wall ladder, library proxies, PDF versions and two last-resort flows across core and the browser extension; grows past 8 sessions if the user's manual checks show session access failing for reasons the rules cannot fix
Pending decisions: 0
Branch: `feat/pdf-finding`, cut from `feat/reader-ux` (72b3dc0), in the worktree `../labshelf-pdf-finding` — `main` predates `import/pdfFinding/`

## 1. Goal

The browser extension finds and downloads the PDF of a paper as often as Zotero and Paperpile do, including the closed papers the user can already read through their institution. "PDF not found" is rare, fast and actionable: one click lets the user sign in or pass a bot check, and the PDF attaches itself. When the user finds the file on their own, it attaches to the right paper without a hunt. When only a preprint exists, the user gets it, labelled as such. When nothing exists, one click drafts an email asking the author for a copy.

## 2. Decisions

Research (2026-10-15, Zotero source, the Paperpile Firefox add-on 1.0.132 source, Martín-Martín et al. 2018) shows that the gap is the order and the fetch context, not missing sources. Both tools start from the article page and the user's session, and they use site-specific PDF rules (Paperpile has about 430 drivers, Zotero about 700 translators). Open-access APIs come second. LabShelf starts from the APIs and has 22 rules.

- [x] **D1** The target is the browser extension. The chain stays in core `import/pdfFinding/`. VS Code and the terminal run the same order, without any session features — saving files with a session happens only in the browser for now.
- [x] **D2** Measure first. A Node harness on a 66-paper corpus measures open access and publisher rules. A 15-paper closed-access checklist, run by the user in Chrome and Firefox with institutional access, measures session gains — Node has no session.
- [x] **D3** Page first. The article page (the user's tab, or the DOI landing page fetched in the background) is parsed before the aggregator results are downloaded, and every download sends the page as Referer — this is what Zotero and Paperpile do.
- [x] **D4** Two stages: all lookups (the page, and the learning and direct resolvers) run concurrently with a 3 s cap, then the ranked candidates download with limited concurrency — this keeps the learners-feed-PMC invariant and makes "not found" fast.
- [x] **D5** Polite per-domain pacing: 1 s between requests to a domain, and a domain is skipped for the run after 5 consecutive failures — publishers block bursts (Zotero's numbers).
- [x] **D6** Publisher rules are a data table ported from the URL shapes in Zotero's translators and the earlier research, rewritten and not copied — Zotero is AGPL; URL shapes are facts. Each rule has a verified example and a unit test.
- [x] **D7** Every fetch has an outcome: `pdf`, `bot`, `login`, `html`, `error`. `bot` matches the wall signatures (§6, S10) on any status and on the final URL. `login` is a 401/403 without bot markers, or HTML with paywall or sign-in markers and no PDF candidate.
- [x] **D8** Bot-wall ladder, browser only: background fetch with cookies → the inactive helper tab (it also passes the PMC proof-of-work, because the page's own script solves it) → on the user's click, a visible tab that is watched and attaches the PDF when it becomes reachable. The visible tab also serves institutional sign-in (CAFe/Shibboleth).
- [x] **D9** Library proxies: an ordered list of `{ name, template, enabled }` in the options page. The kind follows from the template: a prefix with `$@` (Paperpile's convention), a hostname suffix (`.ezproxy.uni.edu`), or the OpenAthens redirector. Only candidates on publisher hosts that answered `login` are retried through them. No credentials are stored, and there is no preset database.
- [x] **D10** The only manifest addition is Chrome's `offscreen` permission, which has no install warning and lets pdf.js read a downloaded PDF's first page (D13). `https://*/*` already covers fetching and reading tab URLs, and the helper tab replaces the `cookies` permission for PMC.
- [x] **D11** A generic custom resolver (a URL template with `{doi}`, whose page goes through the hop parser) takes the place of `sciHub.ts`. It is off by default, and the user fills in any mirror, Sci-Hub or Anna's Archive SciDB included. The extension's code and UI name no shadow library. The stored `enableSciHub`/`sciHubMirror` settings move to one custom-resolver entry through a `migrations/` step.
- [x] **D12** The attempt log records each URL's outcome and status. The "PDF not found" dialog uses it to offer the right action: sign in, pass the check, or ask the author.
- [x] **D13** A PDF the user opens in a tab or downloads is matched against the papers that have no PDF: first by DOI or arXiv id in its URL or referrer, then by the title on page 1. A match offers "Attach to <paper>?" through the toolbar badge and popup, never a system notification, because that would need the `notifications` permission. The extension re-fetches the bytes from the download's final URL with the user's cookies, because extensions cannot read the downloads folder.
- [x] **D14** Every attached PDF records its version, `preprint`, `accepted` or `published`, when the source says so. The chain still prefers the published version, but it attaches a preprint or accepted manuscript when nothing better exists. Lists and the detail pane show a "Preprint" or "Accepted" badge. "Find PDF" on a labelled paper looks for the published version and asks before it replaces the file, warning when notes or highlights exist.
- [x] **D15** "Ask the author" opens a prefilled `mailto:` in the user's own mail client, and LabShelf never sends mail itself. The paper records `pdfRequestedAt`, and the author's address is not stored. Addresses come, cheapest first, from the page's `citation_author_email`, from `mailto:` links near "Correspondence" or "Corresponding author", and from PubMed's "Electronic address:" in `efetch` affiliations. If none is found, the button opens the article page.

- [x] **Q1** The manual checks (A7, A8, A11) run in Chrome and in Firefox, logged separately, because Total Cookie Protection may keep publisher cookies out of background requests in Firefox.

Coordination with the writing plans, which run in parallel:

- **C1** Sessions 7 and 8 fetch and rebase onto the branch the writing plans land on before touching `documents/contracts/library-format.md` and the paper's YAML mapping. The contract change goes in a commit of its own.
- **C2** The "does this preprint have a published version?" lookup (S21) is a reusable core function, because the linter in [writing/2-research-links.plan.md](writing/2-research-links.plan.md) (D6) needs the same lookup. Its path goes in §8.
- **C3** OpenAlex calls reuse the existing clients: `core/src/import/registries/works/openalex.ts` and `core/src/import/pdfFinding/resolvers/learning/openalex.ts`. No third client.
- **C4** S3, S14, S17 and S24 stop and hand the user an exact list of what to test.

## 3. Scope

- **In:** core `import/pdfFinding/` (engine, outcomes, rules, custom resolver), core landing parsing where the rules need it, the browser extension's capture flows, helper and visible tabs, options page and "PDF not found" dialog, a harness under `packages/core/tools/pdf-eval/`.
- **Out:**
  - Re-checking papers without a PDF in the background for copies that appear later — a reader who needs a paper will not wait months for an embargo to end.
  - Interlibrary loan requests (COMUT, a library's request form) — forms differ per library, and asking the author works better.
  - Google Scholar "All versions" and ResearchGate scraping — Google's ToS and CAPTCHAs, and many of those copies infringe; Paperpile does not automate it either.
  - A server-side paper-to-URL map like Paperpile's `/match` — LabShelf is local-first; OpenAlex fills that role.
  - Session access in VS Code and the terminal — they have no browser session (D1).
  - LibKey and OpenURL link resolvers — they need a per-library token or setup and help few papers.
  - Proxy auto-detection and a proxy preset list — the user pastes their library's template.
  - Checking the downloaded PDF's text against the title — no text extraction in the service worker; the metadata `sameWork` check stays.
- **Contracts touched:** [documents/contracts/library-format.md](../contracts/library-format.md), for two optional `metadata.yaml` keys: `pdfVersion` and `pdfRequestedAt`. Settings live in the browser's `storage.local`, not in the library format.

## 4. Acceptance criteria

- [x] **A1** `pnpm --filter @labshelf/core eval:pdf` runs the corpus in the "ids" and "landing" scenarios and prints, per category and in total, correct PDFs, wrong PDFs, misses by outcome, and median times. It writes a JSON report beside the corpus.
- [ ] **A2** On the harness, the "landing" scenario reaches at least 40/66 correct PDFs and "ids" at least 37/66, with at most 2 wrong PDFs (session 1 baseline: landing 35, ids 34, 4 wrong in each).
- [x] **A3** On the harness, the median time to "not found" is at most 3 s and to a found PDF at most 2.5 s.
- [x] **A4** The rule table covers at least 36 publisher platforms. Every rule has a unit test with a verified example DOI or landing URL.
- [x] **A5** Unit tests classify saved fixtures: every wall in S10's table gives `bot` on any status; login pages from Springer, Elsevier, Wiley, IEEE and a CAFe/Shibboleth page give `login`.
- [x] **A6** The prefix, hostname and OpenAthens rewrites are pure and unit-tested, and an end-to-end engine test shows that a `login` candidate is retried through an enabled proxy and an open-access host is not.
- [ ] **A7** Manual, by the user, in Chrome and in Firefox while signed in through the institution: from the closed-access checklist (15 papers), the toolbar popup attaches the correct PDF for at least 12 and the Google Scholar capture for at least 10. The session 1 baseline is in §8.
- [ ] **A8** Manual: when a capture ends in "PDF not found" because of a sign-in or bot wall, the dialog offers "Open to sign in" / "Open to pass the check". After the user signs in or solves it in that tab, the PDF attaches without another click.
- [ ] **A9** With a custom resolver template configured, a DOI that no other source has attaches through it. With none, no request goes to any custom host. A profile that had `enableSciHub` and `sciHubMirror` set opens with one equivalent enabled entry.
- [x] **A10** `pnpm -r typecheck` and `pnpm -r test` pass. A unit test shows that an identifier import in core fetches the DOI landing page and uses its `citation_pdf_url`.
- [ ] **A11** Manual: in Chrome and in Firefox, with a paper in the library that has no PDF, the user downloads its PDF from any site or opens it in a tab. The toolbar badge appears, the popup offers "Attach to <paper>", and one click attaches it. A PDF of an unrelated paper offers nothing.
- [ ] **A12** For a paper whose only free copy is on arXiv, capture attaches it with `pdfVersion: preprint`, and the badge shows in the browser library and in VS Code. A unit test shows that a published candidate outranks a preprint. "Find PDF" on that paper asks before it replaces the file.
- [ ] **A13** `pdfVersion` and `pdfRequestedAt` round-trip through `metadata.yaml` in core tests. A library without them still loads, and VS Code shows the same badge and "requested on" line.
- [ ] **A14** When a capture ends in "PDF not found" with an author address on the page, "Ask the author" opens the mail client with the subject, citation, DOI link and the requester's name and affiliation filled in. The `mailto:` URL is at most 1,800 characters. The detail pane then says "PDF requested from the author on <date>". Unit tests cover address extraction from 5 saved publisher pages, PubMed affiliation strings and `mailto:` encoding.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Harness: corpus JSON, Node runner, report | `packages/core/tools/pdf-eval/` | Manual script, not in `pnpm -r test` (network). Correct = at least 60% of the title's words on pages 1–2, with core's own pdf.js text extraction. |
| Closed-access checklist | `packages/core/tools/pdf-eval/closed.json` | 15 DOIs, one per publisher: Elsevier, Wiley, Springer, IEEE, ACS, T&F, SAGE, APS, IOP, Nature, OUP, Cambridge, JSTOR, AIP, De Gruyter. ACM is left out because its Digital Library is fully open access. |
| Fetch outcome classifier | `core/src/import/pdfFinding/download/` | `pdf / bot / login / html / error` from status, headers, final URL and body. |
| Two-stage engine and domain pacer | `core/src/import/pdfFinding/` | `resolvePdf(ctx, fetchOpts, attempts)` keeps its signature. `PdfAttempt` gains `outcome` and `status`. |
| Page-first context | `core/src/import/` (identifier import) | The DOI landing page becomes `landingUrl` and `pageCandidates` in every app. |
| Publisher rule table | `core/src/import/pdfFinding/rules/` | `{ platform, hosts, doi?: { prefixes, pdfUrls }, landing?: { path, pdfUrls }, examples }`, one file per platform family, so that no folder holds more than 8 files. |
| Proxy rewrite | `core/src/import/pdfFinding/access/` | Pure. The proxy list comes in through `fetchOpts`, so core never reads settings. |
| Access stage | engine, after the open-access candidates | `login` candidates → helper tab → each enabled proxy → verdict. |
| Helper tab and visible watched tab | `packages/browser/src/capture/tab/` | The visible tab opens only on a click in the dialog. It is watched through `tabs.onUpdated` for up to 5 minutes, one tab per paper. |
| "PDF not found" dialog actions | `core/src/library-ui/` copy plus browser glue | Reads `outcome` from the attempts. |
| Options: proxies, custom resolvers | `packages/browser/src/options/` | Stored in `storage.local`. The settings migration goes in `packages/browser/src/platform/migrations/`. |
| Custom resolver | `core/src/import/pdfFinding/resolvers/direct/` | Runs last, with templates from `ResolveContext`. `sciHub.ts` is deleted. |
| PDF-to-paper matcher | `core/src/import/` (pure) | Input: URL, referrer, page-1 text. Output: the best paper without a PDF, or nothing. Ids first, then `sameWork` on the title. |
| Download and PDF-tab watcher | `packages/browser/src/background/` | Uses `downloads.onChanged` (state `complete`) and `tabs.onUpdated` on PDF URLs. Page-1 text comes from pdf.js in an offscreen document in Chrome and from the event page in Firefox. |
| PDF version | `core` types, `metadata.yaml` reader and writer, candidate ranking, library-ui badge | Sources that set it: arXiv and bioRxiv/medRxiv → `preprint`; OpenAlex and Unpaywall `version`; publisher rules → `published`. Any other source leaves it unset. |
| Author contacts | `core/src/import/landing/` (pure) | `RawPage` gains `mailtoLinks`, filled by the page probe and `parseHtmlPage`. PubMed `efetch` goes through the NCBI queue (at most 3 requests/s). |
| Request email | `core/src/library-ui/` (pure builder) plus browser glue | Templates in English, Portuguese and Spanish. The requester's name, affiliation and language live in browser settings. |

## 6. Sessions and steps

Each session ends with typecheck and tests green, the `finish` pass, a harness run logged in §8, and a commit.

### Session 1 — Harness and baseline

- **Starts from:** clean tree on `feat/pdf-finding`
- **Ends with:** A1, the baseline numbers and the user's A7 baseline in §8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Corpus, closed checklist, runner, `eval:pdf` script | — | M · implementer (sonnet) | A1 | [x] |
| S2 | Fetch outcomes in the attempt log | — | M · implementer (sonnet) | outcome unit tests | [x] |
| S3 | Baseline run, plus the user's manual baseline | S1–S2 | H · main thread + user | numbers in §8 | [x] |
| S4 | Finish | S1–S3 | `finish` skill | gate passes | [x] |

### Session 2 — Page first, two stages, pacing

- **Starts from:** session 1 committed
- **Ends with:** A3, A10, harness logged
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | Two-stage engine with a domain pacer | S2 | H · main thread | A3, engine tests | [x] |
| S6 | DOI landing page as page context in identifier import; Referer on downloads | S5 | M · implementer (sonnet) | A10 | [x] |
| S7 | Finish, harness run, and the user's 3-paper check in Chrome and Firefox (Elsevier, Springer, IEEE from `closed.json`) | S5–S6 | `finish` skill + main thread + user | gate passes, §8 | [ ] |

### Session 3 — Publisher rules and wall signatures

- **Starts from:** session 2 committed
- **Ends with:** A4, A5, harness logged
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8 | Rule table schema; move the 22 existing rules into it | S5 | H · main thread | existing tests pass | [x] |
| S9 | Port rules to at least 36 platforms | S8 | M · implementer (sonnet), 2 in parallel by platform family | A4 | [x] |
| S10 | Bot and login signatures with fixtures | S2 | M · implementer (sonnet) | A5 | [x] |
| S11 | Finish and harness run | S8–S10 | `finish` skill + main thread | A2 checked, §8 | [x] |

### Session 4 — Bot-wall ladder and guided sign-in

- **Starts from:** session 3 committed
- **Ends with:** A8, user check in §8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S12 | Helper tab on every `bot` outcome; settle check for every wall | S10 | H · main thread | engine tests, PMC via helper tab | [x] |
| S13 | Visible watched tab with auto-attach; dialog actions | S12 | H · main thread | A8 | [x] |
| S14 | Finish; user runs the closed checklist | S12–S13 | `finish` skill + user | gate passes, §8 | [ ] |

### Session 5 — Library proxies

- **Starts from:** session 4 committed
- **Ends with:** A6, A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S15 | Proxy rewrites and the access stage | S12 | H · main thread | A6 | [x] |
| S16 | Options section for proxies | S15 | M · implementer (sonnet) | settings round trip test | [x] |
| S17 | Finish; user runs A7 | S15–S16 | `finish` skill + user | A7 | [ ] |

### Session 6 — Custom resolver and small sources

- **Starts from:** session 5 committed
- **Ends with:** A9, A2 re-checked
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S18 | Custom resolver, options section, settings migration; delete `sciHub.ts` | S5 | M · implementer (sonnet) | A9 | [ ] |
| S19 | Title-only twins (arXiv title + surname, OpenAlex `autocomplete`) and old-style arXiv ids | S5 | M · implementer (sonnet) | unit tests, harness | [ ] |
| S20 | Finish, final harness run, `documents/apps/browser.md` | S18–S19 | `finish` skill + main thread | A2, A10 | [ ] |

### Session 7 — PDF versions and attaching what the user downloaded

- **Starts from:** session 6 committed
- **Ends with:** A11, A12, A13
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S21 | `pdfVersion` in the contract, types, YAML round trip, ranking and badge | S5 | H · main thread | A12, A13 | [ ] |
| S22 | PDF-to-paper matcher in core | — | M · implementer (sonnet) | matcher unit tests | [ ] |
| S23 | Download and PDF-tab watcher, offscreen text, badge and popup offer | S22 | H · main thread | A11 | [ ] |
| S24 | Finish; user checks A11 | S21–S23 | `finish` skill + user | gate passes | [ ] |

### Session 8 — Ask the author

- **Starts from:** session 7 committed
- **Ends with:** A14, plan done
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S25 | Author contacts: `mailtoLinks`, meta tags, PubMed affiliations | — | M · implementer (sonnet) | extraction tests | [ ] |
| S26 | Request email builder, settings, `pdfRequestedAt` round trip | S21 | M · implementer (sonnet) | encoding and YAML tests | [ ] |
| S27 | "Ask the author" in the dialog and the detail pane | S25–S26 | H · main thread | A14 | [ ] |
| S28 | Finish, docs, delete this plan | S25–S27 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Harness

- **Do:**
  - Build a 66-paper corpus in 10 categories: CS/ML, biomedical, physics/maths, chemistry/engineering, Brazilian/SciELO, social science, preprints, pre-1990, book chapters, and paywalled papers with a free copy.
  - Each entry holds the DOI or other id, the title, the category, and the landing URL.
  - Write a Node runner that calls core's `findPaperPdf` with Node fetch and a Chrome User-Agent, in two scenarios: "ids" (identifiers only) and "landing" (also the article page).
  - A PDF is correct when at least 60% of the title's words appear on pages 1–2.
  - Write `closed.json` with the 15 publishers in §5.
- **Touch:** `packages/core/tools/pdf-eval/`, `packages/core/package.json` (script). **Do not touch:** `packages/core/src/`.
- **Context:**
  - The ResNet DOI `10.1109/CVPR.2016.90` is a known wrong-copy case and belongs in the corpus.
- **Done when:** A1.

#### S2 — Fetch outcomes

- **Do:**
  - Classify every fetch hop as `pdf / bot / login / html / error`.
  - Record the outcome and status in each `PdfAttempt`.
  - `summarizeAttempts` derives `blocked` and `needsLogin` from the outcomes.
- **Touch:** `core/src/import/pdfFinding/download/`, `types.ts`, `resolvePdf.ts`, `packages/browser/src/capture/captureService.ts`. **Do not touch:** the resolver order.
- **Context:**
  - `botCheck.ts` matches only for statuses 202/403/429/503, with a Cloudflare-style regex.
  - S10 widens the signatures. This step only adds the outcome type and the login markers: a password form, "Sign in", "Access through your institution", "Purchase", "Get access".
- **Done when:** unit tests for each outcome pass.

#### S3 — Baseline

- **Do:**
  - Run `eval:pdf` and log the totals in §8.
  - Ask the user to capture the 15 closed papers in Chrome and in Firefox while signed in through the institution, once from the popup and once from Scholar, and log the result.
- **Done when:** both baselines are in §8.

#### S5 — Two-stage engine

- **Do:**
  - Stage A runs all lookups concurrently, with a 3 s cap. A lookup that answers late is dropped.
  - Stage B ranks the candidates (page hints, then publisher rules, then repository and open-access copies, then custom resolvers) and downloads at most 3 at a time. Limits: 10 s to first byte, 30 s per URL, 40 s in total.
  - Accept the first verified `%PDF-`, but hold up to 1 s for a better-ranked candidate that is still in flight.
  - The domain pacer waits 1 s between requests to one host and skips a host after 5 consecutive failures.
- **Touch:** `core/src/import/pdfFinding/` (resolvePdf, engine, download). **Do not touch:** the resolvers' lookup logic.
- **Context:**
  - The INVARIANT in `engine/lookupPlan.ts`: learners reveal ids that PMC and the second arXiv step use, so those steps wait for them.
  - Keep the `resolvePdf(ctx, fetchOpts, attempts)` signature; the dialog reads `attempts`.
- **Done when:** A3, and the engine tests cover ordering, the hold, the pacer and the global limit.

#### S6 — Page first and Referer

- **Do:**
  - In core identifier import, fetch the DOI landing page and pass it as `landingUrl` and `pageCandidates`.
  - Send the page URL as Referer on every download hop.
- **Touch:** `core/src/import/` (importIdentifier, pdfFinding download). **Do not touch:** browser capture flows (they already pass the page).
- **Context:** `importIdentifier.ts:65` passes no landing page today. `importLandingPage.ts:41` shows how the landing page is wired.
- **Done when:** A10.

#### S8 — Rule table

- **Do:**
  - Define the rule shape from §5.
  - Move the existing DOI-prefix and landing rules from `resolvers/direct/publisher.ts` into the table, and delete the old code paths.
  - Apply the landing rules to every landing URL: the tab, doi.org redirects, and the aggregators' landing pages.
- **Touch:** `core/src/import/pdfFinding/rules/`, `resolvers/direct/publisher.ts`. **Do not touch:** the other resolvers.
- **Done when:** the existing tests pass on the table.

#### S9 — Port rules

- **Do:** add rules until the table covers at least 36 platforms. Each rule gets a verified example and a test.
- **Touch:** `core/src/import/pdfFinding/rules/`, its tests. **Do not touch:** the engine.
- **Context:**
  - Read Zotero's translators (`github.com/zotero/translators`) for URL shapes only. Write the code fresh, because the translators are AGPL.
  - Shapes already verified (2026-10-07):
    - Springer `link.springer.com/content/pdf/<doi>.pdf` (prefixes 10.1007, 10.1186, 10.1023)
    - Nature `nature.com/articles/<id>.pdf`
    - IEEE `stampPDF/getPDF.jsp?arnumber=<n>` (fallback `stamp.jsp` iframe)
    - Frontiers `frontiersin.org/articles/<doi>/pdf`
    - PLOS `journals.plos.org/plosone/article/file?id=<doi>&type=printable`
    - MDPI CDN `mdpi-res.com/d_attachment/<slug>/<slug>-<vol>-<art>/article_deploy/<slug>-<vol>-<art>.pdf`
    - eLife via `api.elifesciences.org/articles/<id>`
    - MIT Press `/doi/pdf/<doi>`
  - Shapes known, but behind a login or a wall from Node:
    - Wiley `/doi/pdfdirect/<doi>`
    - ScienceDirect `pii/<PII>/pdfft?download=true` (PII from the `linkinghub` redirect)
    - Atypon `/doi/pdf/<doi>`, `/doi/pdfdirect/<doi>?download=true` (ACM, SIAM, T&F, SAGE, ACS, PNAS, Science, NEJM, INFORMS; ASM and World Scientific add `?download=true`)
    - De Gruyter `degruyterbrill.com/document/doi/<doi>/pdf`
    - Thieme `thieme-connect.com/products/ejournals/pdf/<doi>.pdf`
    - Project Euclid and SPIE: `.full` becomes `.pdf`
    - BMJ `<landing>.full.pdf`
    - AMS `<landing>/<PII>.pdf`
    - JSTOR `/stable/pdfplus/<id>.pdf?acceptTC=true`
    - RSC, Emerald, OUP: use `citation_pdf_url`
  - Split the work into two runners by platform family: Atypon and the Wiley family; everything else.
- **Done when:** A4.

#### S10 — Wall and login signatures

- **Do:** match these on any status, on the final URL and on the headers as well as the body. Each gets a saved fixture and a test.

  | Wall | Signature |
  |---|---|
  | Cloudflare / Akamai | the current regex |
  | F5 / Fastly (Springer, eLife, JSTOR) | `<title>Client Challenge</title>`, `/_fs-ch-` |
  | AWS WAF (IEEE, De Gruyter, figshare) | 202, header `x-amzn-waf-action: challenge`, `token.awswaf.com` |
  | Anubis (HAL, DBLP) | `anubis_challenge` |
  | PMC proof-of-work | `POW_CHALLENGE`, `cloudpmc-viewer-pow` |
  | Radware (IOP) | final host `validate.perfdrive.com` |
  | Imperva (Project Euclid, SPIE) | `_Incapsula_Resource`, header `x-iinfo` |
  | HighWire JavaScript | `function leastFactor(` |
  | MDPI interstitial | `/_sec/verify?provider=interstitial` |

  Also add login fixtures for the five pages in A5.
- **Touch:** `core/src/import/pdfFinding/download/`, `rules/`, tests. **Do not touch:** the browser.
- **Done when:** A5.

#### S12 — Helper tab for every wall

- **Do:**
  - Send every `bot` outcome to the inactive helper tab, not only the ones at the end of the chain. Run it as soon as the background fetch reports a wall, grouped by origin.
  - The settle check waits until none of the S10 signatures is left in the page.
  - For PMC, load the PDF URL in the helper tab, so that the page's own script solves the proof-of-work, then fetch it from inside the tab.
- **Touch:** `packages/browser/src/capture/tab/`, the engine hook in core. **Do not touch:** the manifest.
- **Context:** the helper tab today opens at the origin root and waits up to 15 s, with Cloudflare-only settle markers (`helperTab.ts:67-74`).
- **Done when:** engine tests pass, and a PMC paper outside the open-access bucket downloads in the headless harness (`documents/apps/README.md#verifying-changes`).

#### S13 — Visible watched tab

- **Do:**
  - When the attempts show `login` or an unsolved `bot`, the dialog offers "Open to sign in" or "Open to pass the check".
  - The click opens the best candidate's page in a visible tab and watches it through `tabs.onUpdated` for up to 5 minutes.
  - When the tab shows a PDF, or its page now yields a downloadable PDF candidate, fetch it from inside the tab, attach it with `attachPdfToPaper`, and say so in a toast.
- **Touch:** `packages/browser/src/capture/`, `core/src/library-ui/pdfCopy.ts`, the dialog glue. **Do not touch:** the core engine.
- **Context:** the dialog copy is in `core/src/library-ui/pdfCopy.ts:33-44`. Use the product vocabulary: paper, PDF.
- **Done when:** A8.

#### S15 — Proxies and the access stage

- **Do:**
  - Pure rewrites:
    - prefix: `template.replace("$@", url)`;
    - hostname: replace the host's dots with hyphens and append the suffix;
    - OpenAthens: `go.openathens.net/redirector/<domain>?url=<encoded>`.
  - Access stage: after the open-access candidates, every publisher-host candidate with a `login` outcome goes through the helper tab, then through each enabled proxy in order.
  - A proxy that redirects to its own login page gives `login`, and S13's dialog offers to open it.
- **Touch:** `core/src/import/pdfFinding/access/`, the engine. **Do not touch:** the options page.
- **Done when:** A6.

#### S16 — Proxy options

- **Do:** add an options section that lists proxies (name, template, enabled), validates the template's kind and stores the list in `storage.local`. The background passes the list in `fetchOpts`.
- **Touch:** `packages/browser/src/options/`, `platform/settings.ts`, `captureService.ts`. **Do not touch:** core.
- **Done when:** a settings round-trip test passes.

#### S18 — Custom resolver

- **Do:**
  - Write a core resolver that runs last and builds candidates from `{doi}` templates. Each result page goes through the hop parser.
  - Add an options section for the templates (name, template, enabled), off by default. The help text names no site.
  - Add a migration in `packages/browser/src/platform/migrations/` that turns `enableSciHub` and `sciHubMirror` into one entry. Its header says to delete it once no profile older than this release can exist.
  - Delete `sciHub.ts` and its settings.
- **Touch:** `core/src/import/pdfFinding/resolvers/direct/`, `packages/browser/src/options/`, `platform/settings.ts`. **Do not touch:** the engine.
- **Context:**
  - `sciHub.ts` has its own embed regexes. Keep the ones the generic parser misses, as hop-parser cases, with tests.
  - Anna's Archive SciDB pages show a wait page behind DDoS-Guard. Their outcome is `bot`, and they go to the helper tab.
- **Done when:** A9.

#### S19 — Title-only twins and old-style arXiv ids

- **Do:**
  - For papers without a DOI, try arXiv `ti:"…"+AND+au:<surname>` (8 s timeout), then OpenAlex `autocomplete`, which is free. Gate every hit with `sameWork`.
  - Recognise ids such as `hep-th/9711200` in `doiDetector` and `pageFacts`.
- **Touch:** `core/src/import/`. **Do not touch:** the browser.
- **Done when:** unit tests pass and the harness is logged.

#### S21 — PDF version

- **Do:**
  - Add the optional `pdfVersion` key to `library-format.md` and to the paper record. Write and read it in `metadata.yaml`. A missing key means unknown.
  - Each resolver tags its candidates with a version (the sources are in §5).
  - Candidate ranking puts `published` and untagged copies above `accepted`, and `accepted` above `preprint`. The stage B hold covers this ordering.
  - The shared library UI shows a badge in the list and in the detail pane.
  - "Find PDF" on a labelled paper searches only for a better version. Before it replaces the file, it confirms with the user, and the confirmation warns when notes or highlights exist.
- **Touch:** `documents/contracts/library-format.md`, core types and YAML mapping, `pdfFinding` ranking, `core/src/library-ui/`. **Do not touch:** sync logic, beyond carrying the key.
- **Context:** arXiv and ACL twins found through Semantic Scholar are attached today with no label.
- **Done when:** A12, A13.

#### S22 — Matcher

- **Do:** `matchPdfToPaper({ url, referrer, firstPageText }, papersWithoutPdf)`. Match DOI, arXiv and PMC ids in the URL or referrer first. Otherwise run `sameWork` on the title, taken from the longest early line of page 1 that matches a title. Return nothing on a tie.
- **Touch:** `core/src/import/`. **Do not touch:** the browser.
- **Done when:** unit tests cover id hits, title hits, an unrelated PDF and a tie.

#### S23 — Watcher

- **Do:**
  - Background listeners:
    - `downloads.onChanged` for a completed download that is a PDF (MIME type or `.pdf`);
    - `tabs.onUpdated` for a tab showing a PDF.
  - Re-fetch the bytes from `finalUrl` with credentials. If that fails, offer only the id match and say so in the popup.
  - Get the page-1 text from pdf.js: an offscreen document in Chrome, the event page in Firefox.
  - On a match, set the toolbar badge. The popup offers "Attach to <paper>", which uses `attachPdfToPaper`.
- **Touch:** `packages/browser/src/background/`, `popup/`, `capture/attachPdfToPaper.ts`, `manifest.chrome.json` (`offscreen`). **Do not touch:** core.
- **Context:** first check how the popup handles a PDF tab whose paper is already in the library, and extend that flow rather than adding a second one.
- **Done when:** A11.

#### S25 — Author contacts

- **Do:**
  - Add `authorContacts(raw: RawPage)`. It reads `citation_author_email` next to `citation_author`, and `mailto:` links near "Correspondence", "Corresponding author" or a `*` footnote.
  - Add `emailFromAffiliation(text)` for PubMed's "Electronic address: …".
  - Add `mailtoLinks` to `RawPage`, filled by the page probe and by `parseHtmlPage`.
- **Touch:** `core/src/import/landing/`, `packages/browser/src/capture/pageProbeContentScript.ts`. **Do not touch:** the resolver chain.
- **Done when:** the tests in A14 for 5 saved publisher pages and PubMed strings pass.

#### S26 — Request email

- **Do:**
  - Write a pure `requestCopyMailto(paper, requester, lang)`:
    - subject: `Request for a copy of "<title>"`;
    - body: the citation, the DOI link, "for my personal research", the name and affiliation, and thanks;
    - templates in English, Portuguese and Spanish;
    - at most 1,800 characters.
  - Add settings for the requester's name, affiliation and language.
  - Add `pdfRequestedAt` (an ISO date) to `library-format.md` and the YAML mapping.
- **Touch:** `core/src/library-ui/`, core types and YAML mapping, `packages/browser/src/options/`. **Do not touch:** the dialog.
- **Done when:** the encoding tests (quotes, accents, line breaks, the cap) and the YAML round trip pass.

#### S27 — Ask the author in the UI

- **Do:**
  - Add a runtime message `paper.authorContact { id }`, which returns `{ contacts, articleUrl? }` and is limited to extension pages, like `paper.findPdf`.
  - Show the "Ask the author" button in the "PDF not found" dialog (popup, Scholar, library "Add") and in the "No PDF" detail pane.
  - The click opens the `mailto:` and writes `pdfRequestedAt`. The pane shows "PDF requested from the author on <date>".
- **Touch:** `packages/browser/src/background/`, `popup/`, `core/src/library-ui/dom/detail/`. **Do not touch:** the resolver chain.
- **Done when:** A14.

## 7. Risks

- **R1** Publishers change URLs and walls, so the rules decay. Mitigation: every rule has an example and a test, the harness flags drops, and the decay is a known cost (Paperpile fixes "30+ publishers" every few months).
- **R2** Parallel downloads trigger rate limits or account flags at publishers. Mitigation: the domain pacer (D5), at most 3 downloads at a time, and no bulk mode.
- **R3** The visible-tab watcher attaches a wrong PDF (a supplement or another article). Mitigation: the supplement URL filter, plus the `sameWork` check on the page's `citation_title` before attaching.
- **R4** Node results do not predict the browser. Mitigation: the user's closed checklist (A7) is the parity measure; the harness only guards open access and the rules.
- **R5** Chrome Web Store review flags the custom resolver. Mitigation: it ships generic, empty and off (D11).
- **R6** The download re-fetch fails for one-time signed URLs (for example ScienceDirect's `pdf.sciencedirectassets.com`). Mitigation: the id match still works without bytes; the popup then offers "Attach PDF…" with the paper preselected.
- **R7** Replacing a preprint with the published version breaks highlights anchored to the old pages. Mitigation: replacement always asks first and warns when notes exist (D14).

## 8. Log

- 2026-10-15 — Plan approved. Q1: Chrome only. Branch `feat/pdf-finding` cut from `feat/reader-ux` (72b3dc0), because `main` predates `import/pdfFinding/`. Coordination C1–C4 recorded in §2.
- 2026-10-15 — S2: `FetchOutcome` and the outcome classifier in `download/fetchOutcome.ts`; `PdfMiss.needsLogin` added. Known gap for S10: any HTML page with no PDF candidate and a "Sign in" or "Purchase" link gives `login`, a navbar included.
- 2026-10-15 — S1: harness in `packages/core/tools/pdf-eval/`. Baseline: ids 34/66 correct, 4 wrong, misses by outcome bot 14, html 4, login 3, error 2, timeout 1, none 4; medians found 2.0 s, not-found 2.6 s. Landing 35/66, 4 wrong, misses bot 13, html 5, login 4, error 2, none 3; medians 2.9 s and 2.8 s. Wrong in both: ResNet (OpenAlex copy), graphene RMP (pre-review copy), Braun & Clarke (Dialnet), Nature DQN (supplement). Zero correct in chemistry/engineering and pre-1990. A2 re-based on this corpus.
- 2026-10-15 — S4: finish pass green (typecheck in all four packages; core and browser tests). Harness grouped into `report/` and `loader/`; `eval:pdf` added to `documents/apps/README.md`. ACM swapped for AIP in `closed.json`. Open for S5: an attempt keeps only the last hop's outcome, so a `login` hop followed by an `error` hop records `error`. The access stage (S15) needs the strongest outcome on the chain.
- 2026-10-15 — S3: harness baseline logged above. The user's manual baseline is skipped. It stays reproducible from the `72b3dc0` build, so S14 runs the closed checklist on that build and on the new one, side by side. To catch R4 early, S7 ends with a 3-paper Chrome check (Elsevier, Springer, IEEE) by the user.
- 2026-10-15 — Follow-up plan [google-search-capture.plan.md](google-search-capture.plan.md) (draft) puts the save button on Google search results. It starts after session 3, because it reads the publisher rule table.
- 2026-10-15 18:20 — Q1 changed by the user: the manual checks (A7, A8, A11) run in Chrome and in Firefox. The S14 and S7 manual checks cover both browsers.
- 2026-10-15 21:20 — S5: two-stage engine in `core/src/import/pdfFinding/engine/`. A candidate starts downloading once its lookup and every higher-ranked lookup have answered, so page links start at once instead of after the 3 s cap. Rank: page, landing, publisher, arXiv, learners, learned arXiv, PMC, CrossRef, Unpaywall, custom. An attempt reports the most telling outcome on its hop chain (S4's open item). Deadlines use plain timers, because `AbortSignal.timeout` let the Node harness exit with a run unsettled.
- 2026-10-15 21:20 — S6: the DOI landing page is a lookup inside the engine (`engine/landingLookup.ts`), not a step in `importIdentifier`, so every app and the harness's "ids" scenario get it (D4 lists the page among the lookups). The A10 test is in `importNetworkInput.test.ts`. Known gap: the browser drops a Referer set through fetch, so background downloads in the extension send none; sending it needs `declarativeNetRequest`, a manifest change to decide in S12.
- 2026-10-15 21:25 — S7 harness: ids 34/66 correct, 3 wrong; misses bot 13, error 6, login 4, html 3, none 3; medians found 1.9 s, not-found 1.4 s. Landing 33/66, 4 wrong; medians found 2.4 s, not-found 1.4 s. A3 met. Landing lost 2 against session 1, both external: ImageNet IJCV (Semantic Scholar 429, so no arXiv id; concurrent lookups raise S2 rate limits in the harness, which runs papers in parallel) and Hallmarks of Cancer (EPFL's repository answers 405 with or without Referer). Wrong copies unchanged (OpenAlex pre-review and Dialnet copies, the Nature supplement; ResNet's OpenAlex copy appears in landing). Finish pass green; `pnpm -r typecheck` and `pnpm -r test` pass. Browser lint fails on `libraryMutations.ts:36` (53-line function), which predates this branch.
- 2026-10-15 22:20 — S8: rule table in `core/src/import/pdfFinding/rules/`. Each rule carries `examples`, and `ruleTable.test.ts` runs them all, so a rule without a verified example fails the suite. Landing rules also apply to every HTML hop (`download/nextHops.ts`), which covers doi.org redirects and aggregator landing pages. Per-rule `restricted` paywall signatures were dropped: no live paywall page could be captured (the Springer pages tried were open), and a paywalled hop's next hop already reports `login` through the telling-outcome rule.
- 2026-10-15 22:20 — S9: 46 platforms (A4). Corrections to the step block's shapes: MIT Press `/doi/pdf/<doi>` is a 404 (the PDF URL carries an internal id), so it has no rule; Project Euclid and SPIE are behind Incapsula plus hCaptcha even in a real browser, so `.full`→`.pdf` is unverified and left out; JSTOR's `pdfplus` redirects to `/stable/pdf/<id>.pdf?acceptTC=true`, which the rule emits. Atypon and Wiley PDF URLs all answer a Cloudflare 403 from Node, so their shapes are verified only up to the wall; the DOI redirects confirm the hosts. Royal Society, ATS, SEG, ICE and AMS (meteorology) are no longer on Atypon.
- 2026-10-15 22:20 — S10: wall signatures in `download/wallSignatures.ts`, matched on any status, final URL and headers; the generic Cloudflare/Akamai words stay gated on challenge statuses. Imperva's `x-iinfo` header counts only with a challenge status, because Imperva sends it on every answer. Fixtures: walls f5Fastly, anubis, pmcProofOfWork, imperva, cloudflare, akamai and logins Springer, ScienceDirect, IEEE are live captures; awsWaf (HTML), radware, highwire, mdpi and logins Wiley and Shibboleth are built from the markers (CAFe's WAYF renders in JavaScript). The navbar "Sign in" false positive from S2 remains; no fixture showed a safe narrowing.
- 2026-10-15 22:20 — S11 harness: ids 33/66 correct, 2 wrong; misses bot 17, error 7, login 4, html 2, none 1; medians found 1.9 s, not-found 2.0 s. Landing 33/66, 3 wrong; medians found 2.2 s, not-found 1.8 s. A3 holds; A2 not met. The rules add nothing in Node, because every closed publisher bot-walls Node (R4); their gain shows only with a browser session (A7, S14). Two fixes found on the way: hops read from an HTML answer skip supplements (the Nature DQN wrong copy is gone; Fiji's "correct" copy was its supplement, so it is now a miss), and a doi.org arXiv DOI link counts as an arXiv URL, so OpenAlex no longer proposes a second, paced copy of the arXiv PDF that held the winner back for about 1 s (found median 2.7 s → 1.9 s). The remaining wrong copies come from OpenAlex (Manchester pre-review copy, Dialnet, and a mislabelled UNAL repository file for ResNet). Finish pass green: typecheck in all four packages, core tests pass.
- 2026-10-15 23:07 — S12: a bot wall goes to the helper tab as soon as the background fetch reports it (`engine/helperTabs.ts`), as part of that candidate's download, so its PDF keeps the candidate's rank and a better-ranked PDF cancels the tab. One tab per site per run, at most 2 sites. The tab opens on the walled URL itself, not the site root, and settles when the rendered page shows none of the S10 signatures (`isWallPage`) or is a PDF. The "(via tab)" attempts are gone: an attempt's outcome is its final result. Headless Chrome: two PMC author manuscripts (PMC2761700, PMC4380222) passed the proof-of-work and saved their PDFs in about 3 s. Known risk: a publisher that serves its PDF as an attachment would leave a file in the Downloads folder when the helper tab loads it.
- 2026-10-15 23:07 — S13: `PdfMiss.access` is the best-ranked `login` or `bot` attempt. The dialogs offer "Open to sign in" / "Open to pass the check"; before a save that choice is `ifNoPdf: "open"`, which saves the reference and then opens the page. The watch lives in `storage.session` (it survives the MV3 worker sleeping) and a top-level `tabs.onUpdated` listener checks each load for 5 minutes: the PDF the tab shows, or up to 3 PDF links of a page whose `citation_title` is the same work. Open library pages get a toast through the `library.changed` notice. A8 waits for the user's check in Chrome and Firefox. The Referer gap from S6 stays open: no manifest change was needed for the ladder.
- 2026-10-15 23:07 — S14: finish pass green (typecheck in all four packages; core 2128, browser 138, vscode 255 tests; knip clean after dropping the unused `PublisherRule` re-export). The user's closed checklist (A7, A8) on the `72b3dc0` build and on this one, in Chrome and Firefox, is still to run.

- 2026-10-15 20:22 — S15: rewrites in `core/src/import/pdfFinding/access/proxyRewrite.ts` and the access stage in `access/accessStage.ts`, run from `resolvePdf` only when the download stage found nothing. It retries the `login` attempts on a paywalled rule-table host, or on the article's own site when no rule knows the host. Rules gain `openAccess: true` (`hostAccess`), so open platforms, bioRxiv and the ACL Anthology are never proxied. Order: helper tab per site, then each enabled proxy on the 3 best-ranked pages. A proxy that answers `login` or `bot` gets no more pages, and the next proxy runs. Proxied attempts carry `proxy: <name>`. The step block corrects to EZproxy's host folding: hyphens are doubled before dots become hyphens. Known gap: an HTML sign-in page on a host with a landing rule classifies as `html`, because the rule offers a next hop. Its outcome is `login` only when that hop answers a sign-in, as publishers do with a 403.
- 2026-10-15 20:22 — S16: "Library proxies" options section (`browser/src/options/proxySection.ts`, pure row logic in `proxyRows.ts`). `settings.proxies` is validated on read and passed to `findPaperPdf`. `summarizeAttempts` prefers a proxy's sign-in page, so "Open to sign in" opens the library's login. Checked in headless Chrome: kind labels, inline error, storage round trip and reload, light and dark.
- 2026-10-15 20:22 — S17: finish pass green (core typecheck and 2152 tests, browser typecheck and 148 tests). A7 (closed checklist in Chrome and Firefox, with a proxy configured if the institution has one) and the A8 check from S14 are still to run.
