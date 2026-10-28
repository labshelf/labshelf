# Handoffs

## Kinds

Every handoff is one fenced block tagged with its kind (```` ```yaml spec/v1 ````), at most one block per kind in a message. Unknown keys are errors. The fields of each kind are defined in `scripts/agents/schemas.mjs`; that file is the source, not this list.

| Kind | Returned by | To | Holds |
|---|---|---|---|
| `plan/v1` | orchestrator (`plan new`) | `plan.yaml` | goal, decisions, acceptance, sessions |
| `session/v1` | orchestrator (`plan new`) | `sessions/<id>.yaml` | goal, `depends_on`, `owns`, `milestone`, `status`, packages |
| `spec/v1` | orchestrator | `implementer`, `tester` | one package: files, seams, decided, acceptance, tests |
| `report/v1` | `implementer` | orchestrator | `status` (`done`, `missing`, `blocked_tests`, `failed`), changes, acceptance results |
| `brief/v1` | `explorer` | orchestrator | reuse, edit, read, callers, tests, risks for one area |
| `diagnosis/v1` | `diagnoser` | orchestrator | root cause, regression test, the next `spec` |
| `verdict/v1` | `arbiter` | orchestrator | `code_wrong` (`hint`), `test_wrong` (`fix`), `spec_ambiguous` (`question`) |

## Session handoff

Read when a plan session ends. Write it in the user's language, in at most six lines.

```
## Session <id> done — <plan title>
Done: <package ids> · left: <ids or "nothing">
Commit: <short hash, or "not committed: why">
Next: /orchestrate documents/plans/<slug>/plan.yaml session <id>   (one line per session that can start now; plan.md for legacy plans)
```

A YAML session that cannot finish is set `blocked` with its `blocked_reason`, and "Next" names the sessions that do not depend on it. Only a legacy `.md` session that truly cannot finish writes what is left as `sessions/<id>-<name>.md` (self-contained, same Owns) and names it in "Next". On the last session, replace "Next" with two lines on what the user now has.
