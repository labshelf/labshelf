# Plan: Agent tooling, comment standard and codebase reduction

Status: draft
Size: GG — 8 sessions across rules, hooks, agents, skills, docs, every source file and a repo-wide audit; the reduction work it finds runs as its own plan
Pending decisions: 1

## 1. Goal

Make Claude cheaper and more reliable on LabShelf: each task goes to the right model with a small context, cheap agents are guarded against their usual shortcuts, brainstorming has grill and multi-agent council modes, and code, comments and docs are easy for an agent to search and reuse. Then audit the whole codebase against the minimal-code ladder and produce a ranked reduction plan.

## 2. Decisions

- [ ] **D1** Adapt ideas, install almost nothing. From outside, only Chrome DevTools MCP (extension checks) and Matt Pocock's `git-guardrails` script (MIT) come in. Superpowers, ECC, claude-mem, Graphify, Taste skill and agent-skills are not installed — they duplicate or fight the local setup.
- [ ] **D2** AGENTS.md gains the minimal-code ladder (needs to exist? → already in the codebase? → platform/stdlib → installed dependency → one readable line → minimum code), the never-cut list (trust-boundary validation, data-loss handling, security, accessibility), "no speculative abstraction, option or config" and "no dependency for a few lines". `shortcut:` comments are not adopted.
- [ ] **D3** Comment standard. Line 1 of every file header states the file's capability as a self-contained verb + object sentence, so `rg -m1` over a folder is a map. Why-comments may carry one of four tags: `TRAP:`, `INVARIANT:`, `PLATFORM:` (pdf.js, MV3, VS Code, TTY quirks), `CONTRACT: documents/contracts/<file>.md#<anchor>`. No other tags.
- [ ] **D4** Deterministic tools before LLM sweeps: `knip` (installed) for unused files/exports/deps, `jscpd` (added) for duplication, `depcruise --reaches` for "who imports X". LLM agents judge only what the tools flag.
- [ ] **D5** Model routing by kind of judgment, not task size: Haiku only when the output is machine-checkable; Sonnet when explicit acceptance checks exist; Opus/Fable for contracts, new abstractions, cross-app work, prompt writing and bugs that survived one attempt. Escalation: a Sonnet package that fails acceptance twice or reports concerns moves to Opus, never a third Sonnet retry. Every agent returns a capped, fixed-format report.
- [ ] **D6** `brainstorm` stays one skill with three modes: spar (current), grill (whole frontier per round, numbered, each with a recommended answer; facts go to a Haiku scout), council. Adds: hypothesis with a confidence number, mandatory "Not doing, and why", stop when the next three answers are predictable, a fresh builder-check agent before writing the plan, list of non-approvals. Technique catalogue (pre-mortem, inversion, design-it-twice, convergence moves) lives in `references/`, loaded on demand.
- [ ] **D7** `council` is its own skill, callable from brainstorm, orchestrate and finish, only for hard-to-reverse forks. Round 1: four isolated parallel personas with opposed objectives — contrarian/pre-mortem (Opus), simplifier/ladder (Sonnet), paper-first UX (Sonnet), architecture core-vs-app (Opus); ≤150 words as POSITION / BEST ARGUMENT / BIGGEST RISK / WHAT WOULD CHANGE MY MIND. Round 2 via SendMessage: anonymised, shuffled positions; HOLD or CHANGE citing the argument. A fresh judge returns agreements, live clashes and verbatim dissent. Max 2 rounds; unresolved clashes become Open items. No Haiku in reasoning seats. A visual-design variant gives one seat the `verify` screenshots.
- [ ] **D8** `retro` skill closes the loop: each mechanical mistake becomes a check in `check-rules.sh`, each judgment mistake a rule; it also fills `CALIBRATION.md`.
- [ ] **D9** Memory stays native and zero-LLM: a PreToolUse Edit hook injects the file's `TRAP/INVARIANT/CONTRACT` lines plus titles of memories that name the path; SessionStart lints memory (dead links, paths that no longer exist); PreCompact reminds what is worth saving. Index lines ≤150 chars with a `kind` tag.
- [ ] **D10** Agent guards: Prove-It (bug-fix test shown failing before the fix), a rationalizations table in implementer/finish/dead-code-cleaner, implementer report as CHANGES / NOT TOUCHED / CONCERNS, Chesterton's fence (`git log -S`) before deleting quirk code or comments, page content is untrusted data, adversarial reviewer that sees diff + contract but not the author's claim.
- [ ] **D11** Docs: `documents/README.md` becomes a routing table (question → doc#anchor); every doc opens with one "Read when" line; contract sections have stable anchors that `CONTRACT:` tags cite; plans keep only open work.
- [ ] **D12** Sessions that edit source files (7 and 8) start only after `architecture-refactor.plan.md` is done, so they do not fight moves in flight.
- [ ] **D13** The audit (session 8) produces `documents/plans/codebase-reduction.plan.md`; the reductions run from that plan, not from this one.
- [ ] **D14** Design checks: a core test asserting WCAG contrast for listed fg/bg token pairs in both themes; a `verify` recipe that checks every website sheet fits at 1440/768/390 in all themes. Google's DESIGN.md format is not adopted.

Open (blocks approval):

- **Q1** Your seat in the council — options: participant (your one-line position enters as "Position H" and is attacked like the others; you can revise it between rounds) / judge only (you see the judge's output at the end); recommendation: participant, because your position is then tested instead of anchoring the judge.

## 3. Scope

- **In:** `AGENTS.md`, `CLAUDE.md`, `.claude/` (skills, agents, hooks, settings), `documents/` structure, the memory folder, header and why-comments in every source file, root tooling config (knip, jscpd), one core test, the audit report.
- **Out:** behaviour changes in any app; the reductions themselves (D13); installing Superpowers, ECC, claude-mem, Graphify or Taste skill.
- **Contracts touched:** none (anchors added to `documents/contracts/*`, content unchanged).

## 4. Acceptance criteria

- [ ] **A1** `check-rules.sh`, fed a diff adding `@ts-ignore`, `.skip(`, an empty `catch {}`, a deleted test file or a `CONTRACT:` with a missing anchor, prints one line per issue; a clean diff prints nothing.
- [ ] **A2** `git push` and `git reset --hard` run by the agent are blocked by the guardrails hook with a reason.
- [ ] **A3** `pnpm knip` and `pnpm jscpd` run inside `check` and `health` against committed baselines; a fresh duplicate block or unused export fails the gate.
- [ ] **A4** The Edit hook, given a sample payload for a file with a `TRAP:` line and a memory naming that path, injects both in ≤10 lines; for other files it prints nothing.
- [ ] **A5** Session start prints `STALE?: <memory> -> <path>` for a memory that names a missing path, and nothing when memory is clean.
- [ ] **A6** Every agent file states its model and a return format of ≤40 lines; `orchestrate` states the routing rule and the escalation rule of D5.
- [ ] **A7** A dry run of `/brainstorm` in grill mode on a sample idea asks numbered frontier questions, each with a recommendation, and sends fact questions to a scout.
- [ ] **A8** `/council` on a sample fork runs two rounds and a judge; the main thread receives ≤2k tokens.
- [ ] **A9** `documents/README.md` is a routing table; every doc's first line after the title is "Read when …"; `health` reports any doc without it.
- [ ] **A10** Every source file's header line 1 is a capability sentence; `check-rules.sh` flags new files without one; `rg -m1 '^// ' packages/core/src/<domain>` reads as a map.
- [ ] **A11** The core contrast test passes for both themes and fails if a listed pair drops below 4.5:1.
- [ ] **A12** `codebase-reduction.plan.md` exists with findings ranked by lines saved and risk, each tagged with its ladder rung.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Ladder, never-cut, comment standard, routing rule | `AGENTS.md` §3/§5, `CLAUDE.md` | AGENTS.md grows ≤15 lines; CLAUDE.md loses no-op lines |
| Diff guards, tag lint, header lint | `.claude/hooks/check-rules.sh` | Compares against HEAD like today |
| Guardrails | `.claude/hooks/git-guardrails.sh` | PreToolUse on Bash |
| Edit context injector | `.claude/hooks/edit-context.sh` | PreToolUse on Edit/Write; once per file per session; never blocks |
| Memory lint, PreCompact reminder | `.claude/hooks/session-context.sh`, `.claude/hooks/precompact.sh` | Zero LLM |
| Council | `.claude/skills/council/SKILL.md` + `references/personas.md` | Personas swappable per topic (visual, UX, feature) |
| Brainstorm modes | `.claude/skills/brainstorm/SKILL.md` + `references/techniques.md` | SKILL.md stays ≤100 lines |
| Retro | `.claude/skills/retro/SKILL.md` | Writes checks/rules only after user approval |
| Diagnose | `.claude/agents/bug-tracer.md` → `diagnose` | Red loop before hypotheses, 3–5 ranked hypotheses, `[DEBUG-xxxx]` logs |
| Tool baselines | repo root (`knip.json`, `.jscpd.json`, baselines) | Ratchet: baselines only shrink |
| Contrast test | `packages/core/__tests__/ui/tokens/` | WCAG formula over a list of role pairs |
| Website sheet-fit | `.claude/skills/verify/` recipe | Playwright, per `.page` scroll vs client size |

## 6. Sessions and steps

### Session 1 — Rules and standards

- **Starts from:** clean tree 
- **Ends with:** A6 (rules part), the comment standard written down
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Ladder, never-cut, no-speculation, no-small-deps in AGENTS.md | — | H · main thread | D2 text in place | [ ] |
| S2 | Comment standard (header line 1, four tags) in AGENTS.md §5 | — | H · main thread | D3 text in place | [ ] |
| S3 | Routing + escalation rule in CLAUDE.md; remove no-op lines | — | H · main thread | A6 (rules part) | [ ] |
| S4 | Finish | S1–S3 | `finish` skill | gate passes | [ ] |

### Session 2 — Deterministic gates and hooks

- **Starts from:** session 1 committed
- **Ends with:** A1, A2, A3, A4, A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | Diff guards + tag/header lint in `check-rules.sh` | S2 | M · implementer (sonnet) | A1 | [ ] |
| S6 | `git-guardrails.sh` wired in settings | — | M · implementer (sonnet) | A2 | [ ] |
| S7 | knip config + jscpd + baselines; wire into `check`/`health` | — | M · implementer (sonnet) | A3 | [ ] |
| S8 | `edit-context.sh`, memory lint, PreCompact reminder | S2 | M · implementer (sonnet) | A4, A5 | [ ] |
| S9 | Finish | S5–S8 | `finish` skill | gate passes | [ ] |

### Session 3 — Agents

- **Starts from:** session 2 committed
- **Ends with:** A6
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S10 | Rewrite implementer, test-writer, Explore with D5/D10 guards | S1, S7 | H · main thread | A6 | [ ] |
| S11 | bug-tracer → diagnose; architecture-reviewer adversarial + two axes | — | H · main thread | A6 | [ ] |
| S12 | dead-code-cleaner on knip/jscpd output; comment-enforcer applies D3; Chesterton's fence | S7 | H · main thread | A6 | [ ] |
| S13 | Return-format pass on the other agents | S10–S12 | M · implementer (sonnet) | A6 | [ ] |
| S14 | Finish | S10–S13 | `finish` skill | gate passes | [ ] |

### Session 4 — Brainstorm, council, retro

- **Starts from:** session 3 committed
- **Ends with:** A7, A8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S15 | `council` skill + personas reference | Q1 | H · main thread | A8 | [ ] |
| S16 | `brainstorm` modes + techniques reference | S15 | H · main thread | A7 | [ ] |
| S17 | `retro` skill | — | H · main thread | dry run proposes one check and one rule | [ ] |
| S18 | Dry runs of A7 and A8 on a real pending idea | S15–S16 | H · main thread | A7, A8 | [ ] |
| S19 | Finish | S15–S18 | `finish` skill | gate passes | [ ] |

### Session 5 — Workflow skills and MCP

- **Starts from:** session 4 committed
- **Ends with:** A6 (skills part), DevTools MCP loading the extension
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S20 | `orchestrate`: routing, escalation, doubt step via council, pointer prompts, handoff template to its own file | S15 | H · main thread | A6 | [ ] |
| S21 | `check` fingerprint; `finish` skips a matching gate, two-axis review | S7 | M · implementer (sonnet) | finish reuses a matching check | [ ] |
| S22 | `ship` PR body (evidence, one-way/two-way door); `health` deepening + skill lint | — | M · implementer (sonnet) | — | [ ] |
| S23 | Chrome DevTools MCP (project scope, pinned, `--categoryExtensions`, no telemetry); `verify` recipe for the extension | — | M · implementer (sonnet) | extension popup loads headless, or the recipe documents the headed fallback | [ ] |
| S24 | Finish | S20–S23 | `finish` skill | gate passes | [ ] |

### Session 6 — Docs, memory, design checks

- **Starts from:** session 5 committed
- **Ends with:** A9, A11, website sheet-fit recipe
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S25 | README routing table, "Read when" lines, contract anchors | — | M · doc-keeper (sonnet) | A9 | [ ] |
| S26 | Trim finished sessions out of active plans | — | M · doc-keeper (sonnet) | plans hold open work only | [ ] |
| S27 | Memory index: kind tags, ≤150-char lines, fix stale entries | S8 | H · main thread | A5 prints nothing | [ ] |
| S28 | Core contrast test | — | M · test-writer (sonnet) | A11 | [ ] |
| S29 | Website sheet-fit recipe in `verify` | S23 | M · implementer (sonnet) | recipe reports per-sheet overflow | [ ] |
| S30 | Finish | S25–S29 | `finish` skill | gate passes | [ ] |

### Session 7 — Comment migration (after architecture-refactor is done)

- **Starts from:** session 6 committed and `architecture-refactor.plan.md` done
- **Ends with:** A10
- **Commit:** yes, one commit per package

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S31 | Header line 1 + tags in core, one parallel comment-enforcer per domain | S12 | M · comment-enforcer (sonnet) ×N | A10 for core | [ ] |
| S32 | Same for vscode, browser, terminal | S31 | M · comment-enforcer (sonnet) ×3 | A10 | [ ] |
| S33 | Spot-check 20 random files; tighten the standard if needed | S31–S32 | H · main thread | no vague headers in the sample | [ ] |
| S34 | Finish | S31–S33 | `finish` skill | gate passes | [ ] |

### Session 8 — Ladder audit

- **Starts from:** session 7 committed
- **Ends with:** A12
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S35 | knip + jscpd + depcruise reports | S7 | L · check skill (haiku) | raw findings saved to scratchpad | [ ] |
| S36 | Ladder review per package, in parallel | S35 | H · implementer (opus) ×4, read-only | each returns ranked findings with rung + lines saved | [ ] |
| S37 | Council on the top 5 structural findings | S36 | `council` skill | verdicts recorded | [ ] |
| S38 | Write `codebase-reduction.plan.md` | S36–S37 | H · main thread | A12 | [ ] |

### Step blocks

#### S1 — Ladder in AGENTS.md
- **Do:** add the six rungs and the never-cut list as one short subsection of §3; add "no speculative abstraction, option or config" and "no dependency for a few lines" to §4; add "replies end with what was not checked" to §6.
- **Touch:** `AGENTS.md`. **Do not touch:** other sections' meaning.
- **Context:** Ponytail `AGENTS.md` (github.com/DietrichGebert/ponytail); keep the repo's structure rules (ports, barrels) explicitly above the ladder.
- **Done when:** ≤15 added lines; hook quiet.

#### S2 — Comment standard
- **Do:** define header line 1 (capability, verb + object, no file name) and the four tags with one example each; state that tags are only for why-comments.
- **Touch:** `AGENTS.md` §5.
- **Done when:** D3 text in place.

#### S3 — Routing and CLAUDE.md
- **Do:** replace the division-of-labour table with the D5 rule and the escalation rule; delete lines the model follows by default (Pocock `writing-for-agents`: hunt no-ops).
- **Touch:** `CLAUDE.md`.
- **Done when:** A6 rules part.

#### S5 — Diff guards
- **Do:** in added lines of `git diff HEAD`, flag `@ts-ignore`, `@ts-expect-error` without reason, `eslint-disable`, `.skip(`, `xit(`, empty `catch {}`; flag deleted `__tests__` files; flag `CONTRACT:` whose `#anchor` has no heading in the target doc; flag source files added without a header comment.
- **Touch:** `.claude/hooks/check-rules.sh`, a fixture-driven test script next to it.
- **Done when:** A1.

#### S6 — Guardrails
- **Do:** port `misc/git-guardrails-claude-code` from mattpocock/skills (keep MIT notice); block `git push`, `reset --hard`, `clean -f`, `branch -D`, `checkout .`.
- **Touch:** `.claude/hooks/`, `.claude/settings.json`.
- **Done when:** A2.

#### S7 — knip and jscpd
- **Do:** knip config for the pnpm workspace (entry points per package: extension main, MV3 manifest entries, terminal bin, website js); add jscpd with a min-token threshold and ignore for tests; commit baselines; add both to `check` and `health`; baselines may only shrink.
- **Touch:** root `package.json`, `knip.json`, `.jscpd.json`, baseline files, the two SKILL.md files.
- **Done when:** A3.

#### S8 — Memory and edit hooks
- **Do:** `edit-context.sh`: read `.tool_input.file_path`, print the file's tagged lines and ≤3 memory titles whose body names the path or its folder, once per file per session (marker keyed on session id). Memory lint in `session-context.sh`: index↔file mismatches and backticked paths that do not exist. `precompact.sh`: a ≤8-line reminder of what is worth saving and what is not.
- **Touch:** `.claude/hooks/`, `.claude/settings.json`.
- **Context:** memory dir `~/.claude/projects/-Users-lucanasser-Developer-pessoal-labshelf/memory/`.
- **Done when:** A4, A5.

#### S10 — Implementer, test-writer, Explore
- **Do:** implementer: ladder, read callers before editing, rationalizations table (re-export "for safety", "pre-existing violation", "docs later", "tests pass so done"), CHANGES / NOT TOUCHED / CONCERNS report, escalate instead of a third retry. test-writer: Prove-It, test only at agreed seams. Explore: start from root and domain barrels and header lines, `depcruise --reaches` for importers, a "Reuse candidates" section first in the brief.
- **Touch:** the three agent files.
- **Done when:** A6.

#### S11 — Diagnose and reviewer
- **Do:** rename bug-tracer to diagnose with Pocock's `diagnosing-bugs` loop (no hypothesis before a red command; minimise; 3–5 ranked falsifiable hypotheses; `[DEBUG-xxxx]` logs; regression test at a real seam). architecture-reviewer: receives diff + contract only, "do not validate; find issues or state none", reports Standards and Spec separately, smell baseline.
- **Touch:** the two agent files and every reference to `bug-tracer`.
- **Done when:** A6.

#### S12 — Cleanup agents
- **Do:** dead-code-cleaner works from knip/jscpd output and checks `git log -S` before deleting quirk code; comment-enforcer applies D3 and never deletes a tagged comment.
- **Done when:** A6.

#### S15 — Council
- **Do:** implement D7 with Q1's answer; personas in `references/personas.md` with presets for feature, UX/navigation and visual design; judge prompt; budget and stop rules; failure modes (conformity, verbosity, anchoring).
- **Context:** karpathy/llm-council, aiwithremy/claude-skills-llm-council, BMAD party-mode; evidence: debate rarely beats self-consistency on facts (arxiv 2502.08788), conformity (2509.05396), heterogeneity helps (2309.13007).
- **Done when:** A8.

#### S16 — Brainstorm modes
- **Do:** implement D6; keep the tags and recap; move techniques to `references/techniques.md` grouped frame → diverge → challenge → converge → decide.
- **Context:** mattpocock `grilling`, `domain-modeling`; addyosmani `interview-me`, `idea-refine`; superpowers `brainstorming`.
- **Done when:** A7.

#### S17 — Retro
- **Do:** at the end of a session, list mistakes, sort into mechanical (→ a `check-rules.sh` line) and judgment (→ a rule in the right file), add a CALIBRATION row when a plan finished; apply only after approval.
- **Done when:** a dry run on this conversation proposes at least one check and one rule.

#### S20 — Orchestrate
- **Do:** D5 routing and escalation per package; council as the doubt step for packages touching contracts, sync, manifest or Drive writes; delegated prompts point to files instead of pasting; each open question carries a default; move the handoff template to `references/handoff.md`.
- **Done when:** A6.

#### S23 — Chrome DevTools MCP
- **Do:** add to project `.mcp.json` pinned, with `--categoryExtensions --headless --no-usage-statistics --no-performance-crux`; test `install_extension` on the built browser extension; record the working recipe in `verify`.
- **Done when:** the popup loads headless, or the recipe states the headed fallback.

#### S25–S26 — Docs
- **Do:** routing table; "Read when" line per doc; stable `{#anchor}`-style headings in contracts; delete finished-session blocks from active plans, keeping the log lines.
- **Done when:** A9.

#### S31–S32 — Comment migration
- **Do:** per domain folder, rewrite header line 1 as a capability sentence and tag existing why-comments; never add comments that restate code; delete ones that do.
- **Done when:** A10.

#### S36 — Ladder review
- **Do:** per package, read-only: for each finding give file:lines, the rung that would remove it (1–6), lines saved, risk, and whether core already has it (reuse). Cross-app duplicates first.
- **Done when:** ranked list ≤60 lines per package.

## 7. Risks

- **R1** Hooks add latency or noise on every edit — each hook exits fast when it has nothing to say and fires once per file per session.
- **R2** Council costs ~30k tokens per run — only for hard-to-reverse forks; never automatic.
- **R3** Header migration touches ~600 files and collides with refactor moves — D12 orders it after the refactor; one commit per package.
- **R4** knip false positives on dynamic entry points (manifest, webview scripts) — explicit entries in config; baseline instead of deleting blindly.
- **R5** Tighter agent prompts grow context — every agent file stays within its current size plus 30%; detail goes to references.

## 8. Log
