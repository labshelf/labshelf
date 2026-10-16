# Plan: PDF finding manual checks

Status: approved
Size: 1 session — manual checks in Chrome and Firefox of PDF-finding flows that unit tests and headless Chrome cannot reach; grows for each check that fails

## 1. Goal

Confirm in real Chrome and Firefox the PDF-finding flows that need no institutional access: passing a bot check from the "PDF not found" dialog, attaching a PDF the user downloaded or opened, preprint labels, and asking the author for a copy. The code and its unit tests are in place; only the checks in a real browser are open.

## 2. Decisions

- [x] **D1** Each check runs in Chrome and in Firefox and is logged separately. — Total Cookie Protection in Firefox may keep publisher cookies out of background requests.
- [x] **D2** Session access through an institution (sign-in walls, library proxies, the closed-access checklist in `packages/core/tools/pdf-eval/closed.json`) is out: the user has no institutional access. The archived [pdf-finding plan](../../archive/pdf-finding.plan.md) holds that checklist.
- [x] **D3** No code changes unless a check fails. The checks verify `pdfVersion` and `pdfRequestedAt` in [library-format.md](../../contracts/library-format.md) and touch no contract.
- [x] **D4** The bot-wall watch lasts 5 minutes and lives in `storage.session`. The PDF offer re-fetches the bytes from the download's final URL with the user's cookies, so one-time signed URLs fall back to the id match. The `mailto:` hand-off navigates the captured tab.

## 3. Acceptance

- [ ] **A1** When a capture ends in "PDF not found" because of a bot wall, the dialog offers "Open to pass the check". After the user solves it in that tab, the PDF attaches without another click.
- [ ] **A2** With a paper in the library that has no PDF, the user downloads its PDF from any site or opens it in a tab. The toolbar badge appears, the popup offers "Attach to <paper>", and one click attaches it. A PDF of an unrelated paper offers nothing.
- [ ] **A3** For a paper whose only free copy is on arXiv, capture attaches it with `pdfVersion: preprint`, and the "Preprint" badge shows in the browser library, the detail pane and VS Code. "Find Published Version" on it asks before it replaces the file, and warns when highlights exist.
- [ ] **A4** When a capture ends in "PDF not found" with an author address on the page, "Ask the author" opens the mail client with the subject, citation, DOI link and the requester's name and affiliation filled in. The detail pane then says "PDF requested from the author on <date>". With no address, the article page opens and nothing is recorded.
- [ ] **A5** VS Code shows the "PDF requested from the author on <date>" line for the paper from A4.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | A1–A5 in Chrome and Firefox | none (a fix owns the files it touches) | alone |
