# Plan: Agent context diet

Status: in progress (session 2 of 3)
Size: G — tooling only (settings, agents, skills, hooks, scripts), no app code, but about 15 tooling files and three plan migrations; grows to GG if account-level skills or connectors cannot be turned off per project and need a different mechanism.
Pending decisions: 0

This plan uses the directory format it introduces. Read this file, then only `sessions/<n>.md` for the session you run and the `research/` entries that session names. `log.md` is append-only: add lines with `>>`, never read it whole.

## 1. Goal

Agents start with a small context and stay inside their budgets, so the main thread lasts a whole session and subagents finish their packages with room to spare. Plans stop growing into 13k-token files that every agent rereads. Better code follows from agents that no longer work past 60k tokens.

## 2. Decisions

Facts behind them: [research/baseline-measurements.md](research/baseline-measurements.md), [research/claude-code-settings.md](research/claude-code-settings.md).

- [x] **D1** Cut the starting context first, then reshape plans — the measured waste is the baseline (main ≈52k, unrestricted subagents ≈38k, restricted ≈11k), not single big reads.
- [x] **D2** `"disableClaudeAiConnectors": true` in the project `.claude/settings.json` — Gmail, Drive, Calendar and Docs have no use in this repo.
- [x] **D3** Disable the plugins `pr-review-toolkit`, `code-simplifier`, `hookify`, `frontend-design` — `enabledPlugins` only toggles whole plugins; the first two were never launched; `retro` already turns mistakes into `check-rules.sh` checks, so hookify duplicates it.
- [x] **D4** Replace `frontend-design` with a project skill `ui-design` built on the core design tokens, core icons, AGENTS.md §2 and `documents/product.md`; it covers the three apps only — the generic plugin pushes "distinctive" looks that contradict one product, one look; the website has its own design.
- [x] **D5** Split by invocation, not by topic: user-only skills (`ship`, `retro`, `health`, `brainstorm`, `council`) get `disable-model-invocation: true`; `check`, `finish`, `orchestrate`, `verify`, `ui-design` stay model-invocable — splitting a skill multiplies descriptions; this flag removes them.
- [x] **D6** A new agent `gate` (Read, Grep, Glob, Bash) runs `check`; `finish` forks onto an agent with the same tools plus Edit and Write; `implementer` lists `Read, Edit, Write, Grep, Glob, Bash` — `agent: general-purpose` and a missing `tools:` list load every tool schema.
- [x] **D7** `chrome-devtools` stays in `.mcp.json` and `verify` uses it for the browser extension and webviews, pointed at Playwright's Chrome for Testing; Playwright scripts stay for scripted checks such as `website-sheet-fit.mjs` — it can install extensions, read the console and screenshot, and the installed Chrome crashes headless on this Mac.
- [x] **D8** Plans become `documents/plans/<slug>/` with `plan.md` (≤12,000 chars), `sessions/NN.md` (≤6,000 chars, self-contained steps), `log.md` (append-only) and `research/` — readers load only what they need; a finished session file is deleted and becomes one log line.
- [x] **D9** Research entries carry `sha:` and `files:`; `scripts/research-fresh.mjs` lists entries whose files changed since `sha` (exit 0, list only); stale entries are re-scouted, fresh ones go into the implementer's brief — a carried-over finding with a wrong premise already happened once (CALIBRATION, open-findings).
- [x] **D10** A separate PostToolUse hook `read-budget.mjs` warns the main thread once when it has read more than 60,000 characters (≈15k tokens) of tool output about `packages/`; it never blocks and never fires in a subagent (`agent_id` present) — scouts should do that reading.
- [x] **D11** The template caps a session at about four delegated steps; CALIBRATION gains a main-thread peak column — measured sessions ran 63–75 turns against a budget that fits about 20.
- [x] **D12** Migrate every active plan, `pdf-finding` and `writing/1-writing-core` included, so the tooling reads one format — AGENTS.md §4 forbids two implementations; done sessions collapse into log lines, which is most of pdf-finding's 478 lines.
- [x] **D13** `retro` and CALIBRATION work from `log.md` alone — the finished session files are not needed after they are logged.
- [x] **D14** Build on the current working tree and commit only this plan's files — other sessions may commit in the same tree.

## 3. Scope

- **In:** `.claude/settings.json`, `.mcp.json`, `.claude/agents/`, `.claude/skills/{check,finish,orchestrate,brainstorm,retro,ship,health,council,verify}`, a new `.claude/skills/ui-design/`, `.claude/hooks/`, `scripts/agent-tokens.mjs`, `scripts/agent-transcripts/`, a new `scripts/research-fresh.mjs`, `documents/plans/` (template, calibration, active plans), `CLAUDE.md`.
- **Out:**
  - more reviewers or review per package — the measured defect is context, not missing review;
  - blocking reads — a warning is enough, a block would stop legitimate diagnosis;
  - a research cache without SHA invalidation;
  - dropping `check` after each package — on `gate` it is cheap, and without it an implementer can claim green unproven;
  - splitting skills by topic — it raises the baseline;
  - a `ui-design` section for the website.
- **Contracts touched:** none.

## 4. Acceptance criteria

- [ ] **A1** A fresh session in this repo starts at ≤30k tokens, read from the new baseline column of `node scripts/agent-tokens.mjs`.
- [x] **A2** `gate`, `implementer` and the `finish` agent start at ≤15k tokens each, same report.
- [x] **A3** In a fresh session, `/mcp` and the tool list show no claude.ai connector.
- [x] **A4** The four plugins are off; `/ui-design` exists, and orchestrate names it for UI steps.
- [x] **A5** `verify` installs the browser extension through chrome-devtools on Chrome for Testing, opens its popup and saves a screenshot; it also drives one VS Code webview page.
- [x] **A6** `agent-tokens.mjs` reports per agent: baseline, plan-file reads, report size returned to the caller; `pnpm test:tooling` covers each.
- [x] **A7** `check-rules.sh` warns when a `plan.md` passes 12,000 characters or a session file 6,000; tested.
- [x] **A8** `research-fresh.mjs` lists exactly the entries whose files changed since their `sha`; tested on a fixture repository.
- [ ] **A9** `session-context.sh` lists directory plans with open items and next step, and nothing reads `*.plan.md` anymore.
- [ ] **A10** `read-budget.mjs` warns once in the main thread past the threshold and never in a subagent; tested.
- [ ] **A11** No `*.plan.md` remains under `documents/plans/`; each active plan is a directory within the caps.
- [ ] **A12** Session 3's log records the main-thread peak and the largest subagent peak, both under budget (100k and 60k).

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| connector and plugin switches | `.claude/settings.json` | `disableClaudeAiConnectors`, `enabledPlugins` |
| `gate` agent | `.claude/agents/gate.md` | Read, Grep, Glob, Bash; `check` and `finish` set `agent:` |
| `ui-design` skill | `.claude/skills/ui-design/SKILL.md` | short; points at token files and §2, no copied values |
| chrome-devtools | `.mcp.json` | add the Chrome for Testing executable flag; check its exact name in the installed version |
| plan reader | `session-context.sh`, `lint-docs.sh`, orchestrate, handoff | read `documents/plans/*/plan.md` and `sessions/` |
| research entry | `documents/plans/<slug>/research/<area>.md` | header `sha:`, `files:`, `source:`; body ≤4,000 chars |
| freshness | `scripts/research-fresh.mjs` | `git diff --quiet <sha> -- <files>` per entry |
| read budget | `.claude/hooks/read-budget.mjs` | chars of Read/Grep/Glob/Bash results whose input names `packages/`; state file per session |

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | done, see log | baseline diet and measurement | yes |
| 2 | done, see log | plan directory format, caps, research cache | yes |
| 3 | [sessions/03.md](sessions/03.md) | read budget, migration of every plan, final measurement | yes |

## 7. Risks

- **R1** `disableClaudeAiConnectors` is documented, but account skills (docx, pptx, xlsx…) may stay listed — S1.7 measures; if they stay, report the shortfall, keep A1's number and leave a note in the log.
- **R2** chrome-devtools tool schemas may raise every agent's baseline — S1.6 measures before and after; if the cost is large, restrict it to the agents that run `verify`.
- **R3** The working tree holds another session's uncommitted edits to the same files — commit with explicit file lists only (D14).
- **R4** Restricting `implementer` tools removes WebFetch and MCP — UI verification stays with `verify` in the main thread.

## 8. Log

See [log.md](log.md).
