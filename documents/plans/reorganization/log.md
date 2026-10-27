# Log: Reorganize core, vscode and browser into cohesive modules

<!-- Append-only. One line per finished session: `- <YYYY-MM-DD HH:MM> — <session id> <done/left> <commit> <peak context main/largest subagent>`. Add lines with `>>`; never read the file whole. -->
- 2026-10-26 — S0 rule changes done by hand before the plan (documents/code.md, scripts/lint/modules.mjs, sourceRules 400 lines)
- 2026-10-27 02:59 — 1 done (1.0–1.3, 1.N; lint milestone: 15 long functions, 20 dep violations, knip, 9 test files) 3018ddb8
- 2026-10-27 03:10 — 2 done (2.0–2.4, 2.N; gate --no-lint only, baselines skipped per run policy) 3efac25c
- 2026-10-27 03:28 — 3 done (3.0–3.1, 3.N; gate --no-lint only, baselines skipped per run policy) 718e6e7a
- 2026-10-27 04:00 — 4 done (4.0–4.3, 4.N; gate --no-lint only, baselines skipped per run policy; terminal releaseManifest isRecord also re-pointed; lint:modules orphan-file x3 in spaces/model/json left for lint milestone) 1aec6d0b
- 2026-10-27 04:29 — 5 done (5.0–5.4, 5.N; gate --no-lint only, baselines skipped per run policy; sleep(0) now resolves at once at the 8 replaced sites; keyed vscode sites read the latest entry at fire time; not migrated, outside research list: vscode typstTriggers (per-call delay), latexWriteBuilds, latexTypingWrites, openProjectSignals, sharedPresence; terminal writeFrame sleeps; deviceToken could use sleep(ms, signal); 6 vscode migrated files have no timing test; modulesBaseline has 4 stale orphan-file entries for the deleted homes) d661d5e7
- 2026-10-27 04:57 — 6 done (6.0–6.2, 6.N; lint milestone: full gate + lint PASS, modules baseline -9, jscpd unchanged at 2; fixed orphan-file x3 by folding spaces/model/json into spaces/model; browser bridgeConnection/helperConnection now use toError; not migrated: terminal thumbnailWorker (bundle-size TRAP), .stack ?? .message variants in terminalEntry, hostEntry, runHelperScriptHost, helperEntry; watchSpaces 'message' was a listener, not a copy) COMMIT
