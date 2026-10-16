# Plan: PDF finding manual checks

Status: approved
Size: P — manual checks in Chrome and Firefox of PDF-finding flows that unit tests and headless Chrome cannot reach; grows to M for each check that fails
Pending decisions: 0

## 1. Goal

Confirm in real Chrome and Firefox the PDF-finding flows that need no institutional access: passing a bot check from the "PDF not found" dialog, attaching a PDF the user downloaded or opened, preprint labels, and asking the author for a copy. The code and its unit tests are in place; only the checks in a real browser are open.

## 2. Decisions

- [x] **D1** Each check runs in Chrome and in Firefox and is logged separately. — Total Cookie Protection in Firefox may keep publisher cookies out of background requests.
- [x] **D2** Session access through an institution (sign-in walls, library proxies, the closed-access checklist in `packages/core/tools/pdf-eval/closed.json`) is out: the user has no institutional access. The archived [pdf-finding plan](../../archive/pdf-finding.plan.md) holds that checklist for whoever has it.

## 3. Scope

- **In:** the browser extension's capture, "PDF not found" dialog, PDF offer and "Ask the author"; the VS Code library display of `pdfVersion` and `pdfRequestedAt`.
- **Out:** code changes, unless a check fails; sign-in walls and library proxies (D2).
- **Contracts touched:** none. The checks verify `pdfVersion` and `pdfRequestedAt` in [library-format.md](../../contracts/library-format.md).

## 4. Acceptance criteria

- [ ] **A1** When a capture ends in "PDF not found" because of a bot wall, the dialog offers "Open to pass the check". After the user solves it in that tab, the PDF attaches without another click.
- [ ] **A2** With a paper in the library that has no PDF, the user downloads its PDF from any site or opens it in a tab. The toolbar badge appears, the popup offers "Attach to <paper>", and one click attaches it. A PDF of an unrelated paper offers nothing.
- [ ] **A3** For a paper whose only free copy is on arXiv, capture attaches it with `pdfVersion: preprint`, and the "Preprint" badge shows in the browser library, the detail pane and VS Code. "Find Published Version" on it asks before it replaces the file, and warns when highlights exist.
- [ ] **A4** When a capture ends in "PDF not found" with an author address on the page, "Ask the author" opens the mail client with the subject, citation, DOI link and the requester's name and affiliation filled in. The detail pane then says "PDF requested from the author on <date>". With no address, the article page opens and nothing is recorded.
- [ ] **A5** VS Code shows the "PDF requested from the author on <date>" line for the paper from A4.

## 5. Design

Nothing new. The bot-wall watch lasts 5 minutes and lives in `storage.session`. The PDF offer re-fetches the bytes from the download's final URL with the user's cookies, so one-time signed URLs fall back to the id match. The `mailto:` hand-off navigates the captured tab.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | A1–A5 in Chrome and Firefox | only if a check finds a bug |

Runner tiers: **H** the session model (Opus or Fable); **M** Sonnet; **L** Haiku. Every check is run by the user; the main thread logs the result.

## 7. Risks

- **R1** No paper in reach shows a bot wall on the day of the check. — PMC's proof-of-work page and Wiley's Cloudflare wall both triggered during the original plan; try them first.

## 8. Log

See [log.md](log.md). When A1–A5 are checked, delete this directory.
