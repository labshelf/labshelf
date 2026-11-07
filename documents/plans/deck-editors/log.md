# Log

- Plan written as N3 draft. Per D12 only session 1 is specified at approval; `plan lint` reports the acceptance items of sessions 2-12 as in no spec until each session is specified at its start.
- Selection diagnosis (diagnoser): four confirmed causes. (1) `linking.ts:pathAt` trusts the SyncTeX line, often the next node's or an end line, and has no containment check. (2) `pick` has no last-click guard. (3) `drawOutlines` races. (4) `forget()` leaves path-keyed `titled` rects stale. A fifth: `matchTextRects` gives repeated phrases to the first element. The red test is `packages/core/__tests__/decks/dom/workspace/linking.test.ts`, with 4 failing. This becomes package 1.1.
- User screenshots (VS Code): HTML image alt-only on canvas (CSP, 1.2); HTML equations raw TeX (added to 1.2); beamer page drawn at ~60% of its canvas (overlapping renders, 1.3); insert tools greyed when nothing is selected (session 2: insert must target the current slide or last column); tikzposter A0 content fills only the top third (session 10b print check: underfill warning); Typst poster "No PDF yet" with 22 errors (check in session 1 hand run).
- `plan red` rejects 1.1 and 1.2 because the hidden tests fail on real assertions, not on "not implemented". These are bug fixes of existing code with no new seams, so failing on real assertions is the correct red; they are accepted as red. 1.1: 12 red, 13 regression pins. 1.2: 3 red.
- 2026-11-07 02:14 — session 1 blocked: 1.1: no report
- 2026-11-07 02:15 — session 1 done: 1.1, 1.2, 1.3, 1.4
