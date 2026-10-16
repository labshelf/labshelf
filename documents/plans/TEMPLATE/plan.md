# Plan: <title>

Status: draft | approved | in progress (session <n> of <m>) | done
Size: P | M | G | GG — <one line: why this size>; grows to <next size> if <condition>
Pending decisions: <n>

<!--
How to use this template:
- Copy the TEMPLATE/ directory to documents/plans/<slug>/ and replace every <…>.
- plan.md stays at or under 12,000 characters, each sessions/NN.md at or under 6,000; check-rules.sh warns past them.
- Every item has an id (D1, A1, S1.1, R1). Approve, reject or comment item by item by id.
- An executor reads this file, then only sessions/<n>.md for its session and the research/ entries that session names. Write every session file so that this is enough.
- log.md is append-only: add lines with `>>`, never read it whole. A finished session file is deleted after its log line is written.
- Keep each section as short as it can be. Leave out what the code or documents/ already say, and link instead.
- Delete these comments in the real plan.

Size, in AI work sessions (one session is one conversation, with context still manageable):
  P  one package, a few files ................ minutes, part of a session
  M  core + one app, with tests ............. about one session
  G  core + 2–3 apps, or a new UI surface .... 1–3 sessions
  GG new subsystem or contract change ........ several sessions, the first one a spike
Between two sizes, pick the smaller and write what would make it grow. Check
documents/plans/CALIBRATION.md for how past estimates compared with reality.

A session holds at most about four delegated steps, plus finish and commit: a session
that runs more outgrows the main thread's 100k budget.
-->

## 1. Goal

<Two or three sentences: what the user gets and why it matters. No implementation detail.>

## 2. Decisions

The choices this plan rests on. Each one is a line the user can approve on its own. Facts behind them: <links to research/ entries>.

- [ ] **D1** <decision> — <why, in one clause>
- [ ] **D2** <decision> — <why>

Open (blocks approval):

- **Q1** <question> — options: <a> / <b>; recommendation: <a, because …>

## 3. Scope

- **In:** <apps, surfaces, behaviours>
- **Out:** <what this plan deliberately does not do>
- **Contracts touched:** <documents/contracts/… or "none">

## 4. Acceptance criteria

Each criterion is observable: a user action and its result, or a command and its output.

- [ ] **A1** <criterion>
- [ ] **A2** <criterion>

## 5. Design

Only what an executor cannot infer: placement (core vs app), new data shapes or formats, the UI sketch, and the algorithm in outline. Use a table or a short list, not prose.

| Piece | Lives in | Notes |
|---|---|---|
| <logic> | `core/src/<domain>/` | <…> |
| <glue> | `packages/<app>/src/…` | <…> |

## 6. Sessions

<!--
Size P or M: one session. Size G or GG: one row and one sessions/NN.md per session. A session ends at a point where:
  - typecheck and tests pass;
  - the work is committed;
  - the next session needs nothing from this conversation except plan.md, its session file and research/.
-->

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | <deliverable in a few words> | yes |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

## 7. Risks

- **R1** <what could go wrong> — <mitigation>

## 8. Log

See [log.md](log.md).
