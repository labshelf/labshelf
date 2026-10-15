# Plan: Open findings from the codebase reduction

Status: draft
Size: M — core import metadata plus one browser layout check; grows to G if F73's DOI half needs a new identifier source
Pending decisions: 1

## 1. Goal

Fix the metadata and layout defects the codebase reduction found but left out of scope, so imports get the right title, authors and DOI, and the browser library header reads cleanly.

## 2. Decisions

Open (blocks approval):

- **Q1** F76: where OCR skip reasons name the VS Code setting — options: core returns a reason code and VS Code appends the setting name / keep the text in core; recommendation: reason code, because the terminal would otherwise show VS Code setting names.

## 3. Scope

- **In:** core `import/pdf/` identify and front-page layout, core landing-page parsing, core OCR skip text, browser library page column header.
- **Out:** PDF finding (see `pdf-finding.plan.md`), sync.
- **Contracts touched:** none

## 4. Acceptance criteria

- [ ] **A1** F73: the SIAM 1986 PDF (DOI 10.1137/0215033 printed on page 1) imports with its DOI confirmed; a test with its front-page text proves it.
- [ ] **A2** F75: an all-caps byline ("HIROSHI IMAI AND TAKAO ASANO") yields two authors; a test fails without the fix.
- [ ] **A3** F76: decided per Q1, with a test.
- [ ] **A4** F77: `parseHtmlPage` skips an empty or comment-only `<title>` (IEEE Xplore's Angular placeholder `<!----><!---->`) and uses the first non-empty one; a test fails without the fix.
- [ ] **A5** F78: the browser library page's "Title" column header is not clipped to "Til" on an empty library (seen in session 6's verify; not checked whether it predates it).

## 6. Sessions and steps

### Session 1

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | F75, F77 | — | M · implementer (sonnet) | A2, A4 | [ ] |
| S2 | F73 DOI half (needs the real PDF and network) | — | H · diagnose (opus) | A1 | [ ] |
| S3 | F76, F78 | Q1 | M · implementer (sonnet) + `verify` | A3, A5 | [ ] |
| S4 | Finish | S1–S3 | `finish` skill | gate passes | [ ] |

## 8. Log

- 2026-10-15: written at the close of `codebase-reduction` (its findings F73, F75, F76, F77 and the verify note F78).
