# Log: Math that computes and checks itself in prose

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-11-01 — plan written (draft): 5 sessions, session 1 hidden tests red (1.1 37, 1.2 12, 1.3 20); sessions 2–4 tests deferred to 2.0 (D11)
- 2026-11-01 session 1: 1.1–1.5 done (1.3b added: mathDriver.wl shipped by the builds; 1.5 added rules derivative-operator, implicit-product, lone \mathrm{e}, LetterQ names and formal C/D/K/N/O, widening D3). Measurement: first run 15/16 expressions, 11/14 steps read right; after 1.5 16/16 and 14/14. D11 verdict: go.
- 2026-11-01 09:23 — session 1 blocked: 1.2: missing; 1.4: no report; 1.5: no report
- 2026-11-01 09:23 — session 1 done: 1.1, 1.2, 1.3, 1.3b, 1.4, 1.5
- 2026-11-01 — runner stopped after session 1: a stray un-export of TexRewrite in normaliseTex.ts (index.ts re-exports it) was left uncommitted; discarded, run restarted at session 2
