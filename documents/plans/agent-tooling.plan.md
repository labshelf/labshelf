# Plan: Agent tooling, comment standard and codebase reduction

Status: done
Size: GG — 8 sessions across rules, hooks, agents, skills, docs, every source file and a repo-wide audit; the reduction work it finds runs as its own plan
Pending decisions: 0

## 1. Goal

Make Claude cheaper and more reliable on LabShelf: each task goes to the right model with a small context, cheap agents are guarded against their usual shortcuts, brainstorming has grill and multi-agent council modes, and code, comments and docs are easy for an agent to search and reuse. Then audit the whole codebase against the minimal-code ladder and produce a ranked reduction plan.

## 2. Decisions

- [x] **D1** Adapt ideas, install almost nothing. From outside, only Chrome DevTools MCP (extension checks) and Matt Pocock's `git-guardrails` script (MIT) come in. Superpowers, ECC, claude-mem, Graphify, Taste skill and agent-skills are not installed — they duplicate or fight the local setup.
- [x] **D2** AGENTS.md gains the minimal-code ladder (needs to exist? → already in the codebase? → platform/stdlib → installed dependency → one readable line → minimum code), the never-cut list (trust-boundary validation, data-loss handling, security, accessibility), "no speculative abstraction, option or config" and "no dependency for a few lines". `shortcut:` comments are not adopted.
- [x] **D3** Comment standard. Line 1 of every file header states the file's capability as a self-contained verb + object sentence, so `rg -m1` over a folder is a map. Why-comments may carry one of four tags: `TRAP:`, `INVARIANT:`, `PLATFORM:` (pdf.js, MV3, VS Code, TTY quirks), `CONTRACT: documents/contracts/<file>.md#<anchor>`. No other tags.
- [x] **D4** Deterministic tools before LLM sweeps: `knip` (installed) for unused files/exports/deps, `jscpd` (added) for duplication, `depcruise --reaches` for "who imports X". LLM agents judge only what the tools flag.
- [x] **D5** Model routing by kind of judgment, not task size: Haiku only when the output is machine-checkable; Sonnet when explicit acceptance checks exist; Opus/Fable for contracts, new abstractions, cross-app work, prompt writing and bugs that survived one attempt. Escalation: a Sonnet package that fails acceptance twice or reports concerns moves to Opus, never a third Sonnet retry. Every agent returns a capped, fixed-format report.
- [x] **D6** `brainstorm` stays one skill with three modes: spar (current), grill (whole frontier per round, numbered, each with a recommended answer; facts go to a Haiku scout), council. Adds: hypothesis with a confidence number, mandatory "Not doing, and why", stop when the next three answers are predictable, a fresh builder-check agent before writing the plan, list of non-approvals. Technique catalogue (pre-mortem, inversion, design-it-twice, convergence moves) lives in `references/`, loaded on demand.
- [x] **D7** `council` is its own skill, callable from brainstorm, orchestrate and finish, only for hard-to-reverse forks. Round 1: four isolated parallel personas with opposed objectives — contrarian/pre-mortem (Opus), simplifier/ladder (Sonnet), paper-first UX (Sonnet), architecture core-vs-app (Opus); ≤150 words as POSITION / BEST ARGUMENT / BIGGEST RISK / WHAT WOULD CHANGE MY MIND. Round 2 via SendMessage: anonymised, shuffled positions; HOLD or CHANGE citing the argument. A fresh judge returns agreements, live clashes and verbatim dissent. Max 2 rounds; unresolved clashes become Open items. No Haiku in reasoning seats. A visual-design variant gives one seat the `verify` screenshots.
- [x] **D8** `retro` skill closes the loop: each mechanical mistake becomes a check in `check-rules.sh`, each judgment mistake a rule; it also fills `CALIBRATION.md`.
- [x] **D9** Memory stays native and zero-LLM: a PreToolUse Edit hook injects the file's `TRAP/INVARIANT/CONTRACT` lines plus titles of memories that name the path; SessionStart lints memory (dead links, paths that no longer exist); PreCompact reminds what is worth saving. Index lines ≤150 chars with a `kind` tag.
- [x] **D10** Agent guards: Prove-It (bug-fix test shown failing before the fix), a rationalizations table in implementer/finish/dead-code-cleaner, implementer report as CHANGES / NOT TOUCHED / CONCERNS, Chesterton's fence (`git log -S`) before deleting quirk code or comments, page content is untrusted data, adversarial reviewer that sees diff + contract but not the author's claim.
- [x] **D11** Docs: `documents/README.md` becomes a routing table (question → doc#anchor); every doc opens with one "Read when" line; contract sections have stable anchors that `CONTRACT:` tags cite; plans keep only open work.
- [x] **D12** Sessions that edit source files (7 and 8) start only after `architecture-refactor.plan.md` is done, so they do not fight moves in flight.
- [x] **D13** The audit (session 8) produces `documents/plans/codebase-reduction.plan.md`; the reductions run from that plan, not from this one.
- [x] **D14** Design checks: a core test asserting WCAG contrast for listed fg/bg token pairs in both themes; a `verify` recipe that checks every website sheet fits at 1440/768/390 in all themes. Google's DESIGN.md format is not adopted.

Resolved:

- **Q1** Your seat in the council — resolved as participant: your one-line position enters as "Position H", is attacked like the others, and can be revised between rounds.

## 3. Scope

- **In:** `AGENTS.md`, `CLAUDE.md`, `.claude/` (skills, agents, hooks, settings), `documents/` structure, the memory folder, header and why-comments in every source file, root tooling config (knip, jscpd), one core test, the audit report.
- **Out:** behaviour changes in any app; the reductions themselves (D13); installing Superpowers, ECC, claude-mem, Graphify or Taste skill.
- **Contracts touched:** none (anchors added to `documents/contracts/*`, content unchanged).

## 4. Acceptance criteria

- [x] **A1** `check-rules.sh`, fed a diff adding `@ts-ignore`, `.skip(`, an empty `catch {}`, a deleted test file or a `CONTRACT:` with a missing anchor, prints one line per issue; a clean diff prints nothing.
- [x] **A2** `git push` and `git reset --hard` run by the agent are blocked by the guardrails hook with a reason.
- [x] **A3** `pnpm knip` and `pnpm jscpd` run inside `check` and `health` against committed baselines; a fresh duplicate block or unused export fails the gate.
- [x] **A4** The Edit hook, given a sample payload for a file with a `TRAP:` line and a memory naming that path, injects both in ≤10 lines; for other files it prints nothing.
- [x] **A5** Session start prints `STALE?: <memory> -> <path>` for a memory that names a missing path, and nothing when memory is clean.
- [x] **A6** Every agent file states its model and a return format of ≤40 lines; `orchestrate` states the routing rule and the escalation rule of D5.
- [x] **A7** A dry run of `/brainstorm` in grill mode on a sample idea asks numbered frontier questions, each with a recommendation, and sends fact questions to a scout.
- [x] **A8** `/council` on a sample fork runs two rounds and a judge; the main thread receives ≤2k tokens.
- [x] **A9** `documents/README.md` is a routing table; every doc's first line after the title is "Read when …"; `health` reports any doc without it.
- [x] **A10** Every source file's header line 1 is a capability sentence; `check-rules.sh` flags new files without one; `rg -m1 '^// ' packages/core/src/<domain>` reads as a map.
- [x] **A11** The core contrast test passes for both themes and fails if a listed pair drops below 4.5:1.
- [x] **A12** `codebase-reduction.plan.md` exists with findings ranked by lines saved and risk, each tagged with its ladder rung.

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
| Contrast test | `packages/core/__tests__/ui/dom/` | WCAG formula over a list of role pairs |
| Website sheet-fit | `.claude/skills/verify/` recipe | Playwright, per `.page` scroll vs client size |

## 6. Sessions and steps

### Session 6 — Docs, memory, design checks

- **Starts from:** session 5 committed
- **Ends with:** A9, A11, website sheet-fit recipe
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S25 | README routing table, "Read when" lines, contract anchors | — | M · doc-keeper (sonnet) | A9 | [x] |
| S26 | Trim finished sessions out of active plans | — | M · doc-keeper (sonnet) | plans hold open work only | [x] |
| S27 | Memory index: kind tags, ≤150-char lines, fix stale entries | S8 | H · main thread | A5 prints nothing | [x] |
| S28 | Core contrast test | — | M · test-writer (sonnet) | A11 | [x] |
| S29 | Website sheet-fit recipe in `verify` | S23 | M · implementer (sonnet) | recipe reports per-sheet overflow | [x] |
| S30 | Finish | S25–S29 | `finish` skill | gate passes | [x] |

### Session 7 — Comment migration (after architecture-refactor is done)

- **Starts from:** session 6 committed and `architecture-refactor.plan.md` done
- **Ends with:** A10
- **Commit:** yes, one commit per package

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S31 | Header line 1 + tags in core, one parallel comment-enforcer per domain | S12 | M · comment-enforcer (sonnet) ×N | A10 for core | [x] |
| S32 | Same for vscode, browser, terminal | S31 | M · comment-enforcer (sonnet) ×3 | A10 | [x] |
| S33 | Spot-check 20 random files; tighten the standard if needed | S31–S32 | H · main thread | no vague headers in the sample | [x] |
| S34 | Finish | S31–S33 | `finish` skill | gate passes | [x] |

### Session 8 — Ladder audit

- **Starts from:** session 7 committed
- **Ends with:** A12
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S35 | knip + jscpd + depcruise reports | S7 | L · check skill (haiku) | raw findings saved to scratchpad | [x] |
| S36 | Ladder review per package, in parallel | S35 | H · implementer (opus) ×4, read-only | each returns ranked findings with rung + lines saved | [x] |
| S37 | Council on the top 5 structural findings | S36 | `council` skill | verdicts recorded | [x] |
| S38 | Write `codebase-reduction.plan.md` | S36–S37 | H · main thread | A12 | [x] |

### Step blocks

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
- **R2** Council costs about 200k subagent tokens per run (measured in session 4: four seats of about 43k and a judge of about 36k, mostly repo context) and about 2k in the main thread — only for hard-to-reverse forks; never automatic.
- **R3** Header migration touches ~600 files and collides with refactor moves — D12 orders it after the refactor; one commit per package.
- **R4** knip false positives on dynamic entry points (manifest, webview scripts) — explicit entries in config; baseline instead of deleting blindly.
- **R5** Tighter agent prompts grow context — every agent file stays at or under 65 lines, its return block at or under 40; detail goes to references.

## 8. Log

- 2026-10-14: Session 1 done. All D1–D14 approved, Q1 resolved as participant. S1 (ladder + never-cut in AGENTS.md §3, no-speculation + no-small-deps in §4, "what was not checked" in §6), S2 (header-line-1 and four-tag comment standard in AGENTS.md §5), S3 (CLAUDE.md "Division of labour" table replaced with the D5 routing rule and escalation rule) done. `finish` gate: PASS. Committed.
- 2026-10-14 (session 2): S5 (check-rules.sh gained 7 new diff guards — ts-ignore/eslint-disable/skip/empty-catch via now-vs-HEAD counts, deleted-test-file and CONTRACT-anchor checks, new-file-header check; fixture test `check-rules.test.sh`, 12/12 pass) done. S6 (`git-guardrails.sh`, PreToolUse on Bash, unconditionally blocks git push/reset --hard/clean -f/branch -D/checkout ., wired in settings.json) done. S7 (jscpd added alongside the already-installed knip; both turned into a ratchet gate against committed baselines — `scripts/knip-baseline.json` (79), `scripts/jscpd-baseline.json` (9) — wired into root `knip`/`jscpd` scripts and into `check`/`health` SKILL.md; regression simulated and reverted for both, confirming the gate fails) done. S8 (`edit-context.sh`, PreToolUse on Edit/Write, injects TRAP/INVARIANT/PLATFORM/CONTRACT lines + up to 3 matching memory titles, deduped per session via `/tmp` marker; memory lint added to `session-context.sh`, printing `STALE?:` for missing memory files or broken repo paths) done. `finish` surfaced two real deviations, fixed in this session: (1) the real memory index had two genuinely stale paths (`packages/reader`, old browser `tokens.css` location) from the architecture-refactor's phases 8-9 landing — updated `shared-reader-package.md` and `browser-extension-vscode-parity.md` to the current `packages/core/src/reader` / `packages/core/src/ui/dom/tokens.css` layout; (2) the memory-lint heuristic flagged ~15 false positives from pre-existing memory files' relative path shorthand — tightened it to only check tokens rooted at a real top-level directory (`packages/`, `documents/`, `scripts/`, etc.), verified it still catches a genuinely broken path via an isolated fixture; (3) `package.json` had `lint:unused`/`knip` and `lint:dup`/`jscpd` as duplicate names for the same script (AGENTS.md §4) — collapsed `lint` to call `knip`/`jscpd` directly. Deviation: unrelated, pre-existing uncommitted work in `packages/terminal` (a different in-progress task) triggered the new deleted-test-file check as expected noise — left untouched, out of scope for this session. `finish` gate (session-2 files only): PASS. A1–A5 all verified and ticked.- 2026-10-14 (session 3): S10 implementer (ladder, read callers, shortcuts table, CHANGES/TESTS/ACCEPTANCE/NOT TOUCHED/CONCERNS), test-writer (public seam, Prove-It), Explore (barrels + header lines first, `depcruise --reaches`, Reuse candidates first). S11 bug-tracer renamed to `diagnose`: red → minimise → 3–5 falsifiable hypotheses → `[DEBUG-xxxx]` logs → failing regression test; it gains Edit/Write for those and never writes the fix. architecture-reviewer: adversarial, ignores author claims, Standards and Spec axes, block/fix/note. S12 dead-code-cleaner from knip/jscpd output with Chesterton's fence; comment-enforcer applies D3 and never deletes tagged comments. S13 (Sonnet): return blocks capped at 40 lines on the other six agents.
- 2026-10-14 (session 3) deviations: the orchestrate D5 routing and escalation lines are added here to close A6, and the rest of S20 stays in session 5. R5 is amended from "+30%" to an absolute cap (≤65 lines per file, ≤40-line return block), because the required tables and return blocks pushed six files to +50–105%. `finish` gate: PASS. Uncommitted `packages/vscode` work from another session was left out of scope.
- 2026-10-14 21:56 (session 4): S15 `council` skill: a gate (fork? hard to reverse? neutral brief, Position H), round 1 with four isolated seats, round 2 via SendMessage with `sort -R`-shuffled labels and HOLD/CHANGE citing an argument, an Opus judge, and the hand-back to Open items; Feature, UX/navigation and Visual presets in `references/personas.md`. S16 `brainstorm`: spar/grill/council modes, a hypothesis with confidence, mandatory "Not doing", the predictable-answers stop, a list of non-approvals and a Sonnet builder check; techniques in `references/techniques.md` (frame → diverge → challenge → converge → decide). SKILL.md is 67 lines. S17 `retro` skill: collect → sort (mechanical/judgment/estimate) → propose ≤40 lines → apply only approved items, with a fixture test per check.
- 2026-10-14 21:56 (session 4) S18 dry runs: grill on pdf-finding §4 (institutional access) asked 6 numbered frontier questions, each with a recommendation; a Haiku scout answered the code facts (tab fetch already uses `credentials: "include"`; no proxy code), and its answers came back marked verified (A7). The council on architecture-refactor Q1 ran two rounds and a judge: 4/4 seats chose in-memory after round 2 (the Contrarian changed, citing P5's fallback fact). Two new gates were recorded under refactor Q1, and the main thread took in about 1.7k tokens (A8). The retro dry run on this conversation proposed 1 check and 2 rules (S17). Deviation: the council costs about 200k subagent tokens, not 30k. R2, the council skill and CLAUDE.md state the measured figure. Finish could not call the council itself (forked skills cannot launch agents), so a council is run on a fork that finish reports. `finish` gate: PASS.
- 2026-10-14 22:00 (session 5): S20 `orchestrate`: open questions carry a default and two-way defaults are applied rather than asked; each package names its model and its door (one-way: contracts or on-disk formats, sync, Drive writes, manifest or permissions); a one-way package with two viable designs goes to `council` first; delegated prompts point to files instead of pasting; the handoff template lives in `references/handoff.md`. S21 `check/fingerprint.sh` hashes HEAD plus the uncommitted change; `check` writes it with the result to `.git/labshelf-check`, and `finish` reuses a matching PASS and reports Standards and Spec review axes. S22 `ship` writes a PR body (evidence, not checked, door) without pushing; `health` uses depcruise for boundaries and runs `health/lint-skills.sh` (frontmatter, agent ≤65 and SKILL ≤110 lines, referenced paths exist, history language). S23 `.mcp.json` pins `chrome-devtools-mcp@1.10.1` headless, isolated, extensions on, telemetry off; driven over stdio, `install_extension` loaded the built Chrome extension and the popup rendered headless (recipe in `documents/apps/browser.md`). `finish` gate: PASS.
- 2026-10-14 22:00 (session 5) deviations: the skill lint caught history language in `changelog-writer.md` and `doc-keeper.md`, so both were reworded. `pnpm lint:deps` currently fails: 62 violations are outside its baseline and 27 baseline entries are stale. This predates the session and is left for the architecture-refactor plan. MCP extension paths must lie inside the client's workspace roots, and whether Claude Code sends the project directory as a root is not yet verified in a live session. If `install_extension` is denied, add `--workspace` args.
- 2026-10-14 22:08 (session 6): S25 `documents/README.md` is a routing table (34 question rows → `doc.md#anchor`, every target checked); every doc outside `plans/` opens with a "Read when" line; contract anchors stay GitHub slugs, which `check-rules.sh` resolves; `health/lint-docs.sh` reports a doc without the line (A9). S26 the agent-tooling plan keeps sessions 6–8 (285 → 143 lines), architecture-refactor keeps sessions 7, 12, 13 plus the S0.4 and S4.3 blocks that open steps cite (823 → 375), pdf-finding loses its done step; open-item and log-line counts unchanged. S27 memory lint checks every repo-rooted path, not only backticked ones, and found 3 stale paths, now fixed; index lines carry a kind tag and stay ≤150 chars. S28 `packages/core/__tests__/ui/dom/tokenContrast.test.ts` checks 24 UI pairs in dark and light and 4 reader pairs in 4 reader themes against 4.5:1 (A11). S29 `verify/website-sheet-fit.mjs` checks 10 sheets × 3 widths × 4 themes over CDP: 0 overflowing, and an injected overflow exits 1. `finish` gate: PASS.
- 2026-10-14 22:08 (session 6) deviations: the contrast test found sepia `--ls-reader-desc` at 4.14:1 on the reader surface; it is 11–12px text, so it is darkened to #72604e (4.82:1) in `tokens.css` and `readerThemeTokens.ts`. `--ls-warning` colours only icons, so the test checks banner text (`--ls-fg`) on `--ls-warning-bg` instead; the light warning icon is 2.81:1, below the 3:1 non-text minimum, and is left open. The test lives in `__tests__/ui/dom/`, mirroring `src/ui/dom/tokens.css`, not `__tests__/ui/tokens/` as §5 says.
- 2026-10-15 10:08 (session 7): S31 six comment-enforcer agents (Sonnet), one per core folder group, rewrote about 330 noun-phrase headers to capability sentences; barrels read "Exports the <area>'s public API."; sync gained `CONTRACT:` tags against `sync.md` anchors, and pdf.js, Drive and MV3 quirks gained `PLATFORM:`/`TRAP:` tags. The token generators emit capability headers into `tokens.css` and `vscodeHost.css`. S32 the same for vscode, browser and terminal (about 140 headers). `check-rules.sh` flags a new file whose header line 1 does not start with a third-person verb, accepts `/* */` CSS headers, and its fixtures cover noun-phrase, plural-noun, CSS and JSDoc headers (16/16). A repo-wide scan of 859 files finds no header that fails the rule.
- 2026-10-15 10:08 (session 7) S33: a 20-file random sample had no vague headers. The standard was tightened on one point: 123 `@returns void` lines were deleted mechanically, and `comment-enforcer` names `@returns` lines that restate the signature as removable; about 500 other `@returns` lines remain for case-by-case review. S34 `finish` gate: PASS (core 1785, vscode 352, browser 105, terminal 859 tests). Its one judgment item, `void result;` in `googleDriveProvider.ts`, became a bare `await`.
- 2026-10-15 11:16 (session 8): S35 knip 0 issues, depcruise 0 violations, jscpd 30 clones at minTokens 40 / minLines 4 (raw, not the gate). S36 five read-only Opus reviewers (core domain, core UI, vscode, browser, terminal) returned 86 findings; merged and de-duplicated into 70 ranked rows (about 2,430 lines, about 2,300 planned). S37 gate applied to the top structural findings: the Node file-system adapters and the cite-key/root-storage questions went to Explore fact checks, the AI layer and the settings webview went to the user (delete unread AI parts; replace the webview with viewsWelcome), and two councils ran (LibraryOperations → one core `resolvePaperRefs` with an injected lookup; cite-key → `makeCiteKey` with trusted authors only). S38 `codebase-reduction.plan.md` written (6 sessions, GG) with the findings table in §9 (A12).
- 2026-10-15 11:16 (session 8) deviations: S36 used five reviewers, because core (24k lines) split into domain and UI halves. Subagents cannot write report files, so the main thread saved their tables. S37 ran two councils instead of five, because the other top findings were facts or product calls, which the council gate excludes. The audit found a data-loss bug, which is session 1 of the reduction plan: the terminal sync's `NodeLocalFileSystem.listDir` returns [] on any error, so a read error deletes unchanged remote copies. `knip --production` gives only noise, because the knip entries are not marked as production entries.
