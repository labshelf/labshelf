# Log: Agent pipeline

<!-- Append-only. One line per finished step or session: `- <YYYY-MM-DD HH:MM> — <step id> <what was done, any deviation>`. Add lines with `>>`; never read the file whole. A closed session adds one line with the peak context of the main thread and of the largest subagent. -->
- 2026-10-28 00:45 — session 1 done: 1.1–1.6 (P2 SubagentStop block unusable, fallback PostToolUse on Agent confirmed; agent-telemetry plan_events + Pipeline report outside repo); commit 4488b3fd; peak context main ~45k, largest subagent ~36k
- 2026-10-28 00:51 — session 2 done: 2.1–2.4 (verify/SKILL.md build line also wrapped; guard skips bash -c and $(...)); commit 55f6a760; peak context main ~35k, largest subagent ~41k
- 2026-10-28 00:56 — session 3 done: 3.1–3.4 (check-handoff is PostToolUse on Agent per P2 fallback, not SubagentStop; gate --no-lint only); commit d62f55b5; peak context main ~30k, largest subagent ~42k
- 2026-10-28 01:05 — session 4 done: 4.1–4.2 (spec-guard PreToolUse hook, 11 tests; hook also emits index_query per allowed ctx call — session 8 must not double-emit from the ctx CLI; Grep/Glob denied for tester and arbiter too; tester may run exact tests.command/commands; arbiter logs path not worktree-aware; gate --no-lint only); commit dd3837f4; peak context main ~25k, largest subagent ~45k
