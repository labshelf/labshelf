# Telemetry events

Every line: `{ts, kind, run_id, plan, session, spec, agent_type, session_id, cwd, …fields}`. `run_id` comes from `$LABSHELF_PLAN_RUN_ID` (set by the runner), `session_id` is the Claude session id when the emitter is a hook (hooks receive it) or the runner (stream-json init event).

| Kind | Emitted by | Extra fields |
|---|---|---|
| `run_started` | runPlan | `options` |
| `session_started` | runPlan | `session_id`, `model` |
| `session_closed` | `plan close` / runPlan | `status` (done, blocked, failed), `commits`, `cost_usd` (from the `-p` result) |
| `package_started` | `plan start` | `level`, `model` |
| `package_report` | `check-handoff` | `status`, `acceptance_pass`, `acceptance_fail` |
| `test_run` | `run.mjs test --spec` | `failing`, `attempt`, `exit` |
| `test_blocked` | `run.mjs test --spec` | `attempt`, `reason` (no_progress, max_runs) |
| `arbiter_verdict` | `check-handoff` | `verdict` |
| `spec_deny` | `spec-guard` | `tool`, `target` |
| `missing` | `check-handoff` | `needs` (count) |
| `index_query` | `facts` CLI | `query_kind` (def, callers, uses, fn, sig, similar, find, tests), `results`, `chars` |
| `dup_check` | `dup-guard` | `units`, `warned`, `ms` |
| `dup_warning` | `dup-guard` | `unit`, `match`, `score`, `reason` (exact, similar, name) |
| `budget_warning` | `context-budget.mjs` | `context_tokens`, `budget` |
| `commit` | `plan close` | `hash`, `files` |
| `handoff_invalid` | `check-handoff` | `schema`, `errors` (count), `blocks` |

The emitter does not validate kinds; the ETL stores unknown fields in `extra`.
