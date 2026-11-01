# Log: Math that computes and checks itself in prose

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-11-01 — plan written (draft): 5 sessions, session 1 hidden tests red (1.1 37, 1.2 12, 1.3 20); sessions 2–4 tests deferred to 2.0 (D11)
- 2026-11-01 session 1: 1.1–1.5 done (1.3b added: mathDriver.wl shipped by the builds; 1.5 added rules derivative-operator, implicit-product, lone \mathrm{e}, LetterQ names and formal C/D/K/N/O, widening D3). Measurement: first run 15/16 expressions, 11/14 steps read right; after 1.5 16/16 and 14/14. D11 verdict: go.
- 2026-11-01 09:23 — session 1 blocked: 1.2: missing; 1.4: no report; 1.5: no report
- 2026-11-01 09:23 — session 1 done: 1.1, 1.2, 1.3, 1.3b, 1.4, 1.5
- 2026-11-01 — runner stopped after session 1: a stray un-export of TexRewrite in normaliseTex.ts (index.ts re-exports it) was left uncommitted; discarded, run restarted at session 2
- 2026-11-01 — session 2, 2.0 done (handoff at the context warning): hidden tests written for 2.1–2.3, 3.1–3.3, 4.1–4.3, specs point at them, plan lint silent; each spec creates a module named after its test (the mirror rule; `plan start` would overwrite an existing test), and the names the tests pin are in each spec's decided. Found that spec 1.2 (runMath, MathRequest/MathResult) was reported done in session 1 but never committed; new package 2.0b re-lands it from .git/labshelf-runs/math-in-prose/1.2.patch (+ 1.5.patch, the reader test), both apply cleanly; session 2 owns widened for it. Open: `plan red` rejects 4.1 (the whole file fails, not "not implemented", even after splitting its seam) and 3.1 (24 malformed-stays-text tests pass today, as they should; deriveResultSource file fails at load); not run for the no-seam specs. Pending: 2.0b, 2.1, 2.2, 2.3, finish, close.
- 2026-11-01 10:34 — session 2 blocked: 2.0: no report; 2.1: missing
- 2026-11-01 10:35 — session 2 done: 2.0, 2.0b, 2.1, 2.2, 2.3, 2.4
- 2026-11-01 11:27 — session 3 done: 3.0b, 3.1, 3.2, 3.3, 3.4
