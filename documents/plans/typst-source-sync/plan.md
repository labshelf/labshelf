# Plan: Typst source↔PDF sync without SyncTeX

Status: draft
Size: unknown — spike first; the sessions are written after Q1 is answered, and grow if neither path is reliable

## 1. Goal

In a Typst project, double-clicking the preview jumps to the source line, and "show in preview" jumps from the cursor to the PDF, as LaTeX already does through SyncTeX. Typst produces no SyncTeX.

## 2. Decisions

- [ ] **D1** Scope is the VS Code preview (reader-host `showSource`/`revealSource` for Typst). Everything else is out until Q1 is answered. Possibly touches [reader-host.md](../../contracts/reader-host.md#preview). Linked from [writing-project-workspace](../writing-project-workspace/plan.md).

Open (blocks approval):

- **Q1** Which position source? Spike first: does the typst.ts renderer expose source spans per rendered element? (Tinymist's preview jumps exactly, so the compiler has them.) — a) source spans from the renderer; b) typst.ts `query` for heading/figure/label page positions (verified: web compiler 0.7 exposes `query`, with no jump API), plus a fuzzy match on the pdf.js text layer for clicks in prose. Recommendation: a if the spike finds spans, otherwise b.

## 3. Acceptance

- [ ] **A1** Double-clicking the Typst preview moves the editor to the matching source line.
- [ ] **A2** "Show in preview" moves the preview to the page position of the cursor.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| — | — | written after the spike answers Q1 | — | — |
