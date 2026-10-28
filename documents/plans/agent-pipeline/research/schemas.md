# Handoff schemas (v1)

Every handoff is one fenced block in a message, tagged with its kind: ```` ```yaml spec/v1 ````. A message holds at most one block per kind. Unknown keys are errors. Paths are repo-relative. `lines` is `"<from>-<to>"`. Ids are strings (`"3.2"`).

## plan/v1 — `documents/plans/<slug>/plan.yaml`

```yaml
schema: plan/v1
slug: agent-pipeline
title: Agent pipeline
status: draft            # draft | approved | in_progress | done
level: N3                # N2 | N3 (N0/N1 never get a plan file)
goal: >-
  Two or three sentences.
decisions:
  - {id: D1, text: "...", why: "..."}
acceptance:
  - {id: A1, check: "observable check"}
sessions:
  - {id: "1", file: sessions/1.yaml, depends_on: [], owns: [scripts/agents/]}
```

## session/v1 — `sessions/<id>.yaml`

```yaml
schema: session/v1
id: "3"
goal: one sentence
depends_on: ["2"]
owns: [scripts/agents/schemas.mjs, .claude/agents/]
milestone: false         # true: full gate and lint at close
status: pending          # pending | blocked | done
blocked_reason: null
packages: [<spec/v1 without the schema key>, ...]
```

## spec/v1 — orchestrator → implementer (also a session package)

```yaml
schema: spec/v1
id: "3.2"
plan: agent-pipeline
goal: one sentence
level: behaviour         # task | behaviour | contract
runner: {agent: implementer, model: sonnet}   # model: sonnet | opus | fable
sha: 3296ad93            # commit the facts below were read at
depends_on: ["3.1"]
edit:                    # files it may change (Read allowed on the whole file)
  - {path: scripts/agents/schemas.mjs, lines: "1-80", why: "..."}
create: [scripts/agents/__tests__/]   # files or folders it may create
read:                    # read-only context
  - {path: .claude/hooks/context-budget.mjs, lines: "40-50", why: "transcript lookup"}
callers:                 # who breaks if a signature changes
  - {symbol: emit, path: scripts/plans/runPlan.mjs, lines: "160-170"}
seams:                   # public signatures the hidden tests call; plan stubs generates them
  - {path: scripts/agents/schemas.mjs, signature: "export function validate(kind, value)"}
decided: ["names, shapes and placement the implementer must not re-decide"]
acceptance:
  - {id: A2, check: "..."}
tests:                   # or: tests: {none: "reason"} for layout, CSS, copy, glue
  hidden: [documents/plans/agent-pipeline/tests/3.2/scripts/agents/__tests__/schemas.test.mjs]
  command: node scripts/agents/run.mjs test tooling --spec 3.2 -- scripts/agents/__tests__/schemas.test.mjs
commands:                # other commands it may run
  - node scripts/agents/run.mjs typecheck core
do_not_touch: [.claude/settings.json]
```

## report/v1 — implementer → orchestrator

```yaml
schema: report/v1
spec: "3.2"
status: done             # done | blocked_tests | missing | failed
changes:
  - {path: scripts/agents/schemas.mjs, what: "one line"}
acceptance:
  - {id: A2, result: pass, note: ""}       # pass | fail | unchecked
missing:                 # required when status is missing
  - {need: "callers of validate in .claude/hooks", why: "signature change"}
not_touched: ["in scope, left on purpose, and why"]
concerns: ["design doubts, out-of-scope issues, docs to update"]
```

## brief/v1 — explorer → orchestrator

```yaml
schema: brief/v1
area: plan scaffolding
question: "what the scout was asked"
sha: 3296ad93
reuse:    [{symbol, path, lines, why}]
edit:     [{path, lines, why}]
read:     [{path, lines, why}]
callers:  [{symbol, path, lines}]
tests:    [{path, covers}]
contracts: ["code#placement"]
commands: ["node scripts/agents/run.mjs test core -- <path>"]
risks:    ["..."]
```

`plan from-brief` copies `edit`, `read`, `callers`, `commands` and `sha` into a draft spec.

## diagnosis/v1 — diagnoser → orchestrator

```yaml
schema: diagnosis/v1
red: {command: "...", failure: "one line"}
hypotheses:
  - {status: confirmed, path, lines, claim, evidence}   # confirmed | falsified | untested
call_chain: [{path, lines}]
root_cause: {path, lines, claim}
regression_test: {path, name}
also_affected: ["..."]
spec:                    # partial spec/v1: edit, read, callers, acceptance, tests.hidden = [regression test]
  goal: "..."
  edit: [...]
```

## verdict/v1 — arbiter → script

```yaml
schema: verdict/v1
spec: "3.2"
verdict: code_wrong      # code_wrong | test_wrong | spec_ambiguous
evidence:
  - {test: "A2 rejects unknown keys", assertion: "...", spec_ref: "acceptance A2", reason: "..."}
hint: "for code_wrong: what the next implementer should change"
fix: "for test_wrong: what the tester should change and why the spec supports it"
question: "for spec_ambiguous: the two readings, in two lines"
```

Routing: `code_wrong` → a new implementer on `opus` with the hint; `test_wrong` → `tester` fixes the test, event `test_fixed`; `spec_ambiguous` → the session is marked `blocked` with the question (unattended) or the question goes to the user.
