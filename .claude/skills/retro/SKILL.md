---
name: retro
description: End-of-session retrospective — lists the mistakes made in this conversation, turns each mechanical one into a check in .claude/hooks/check-rules.sh and each judgment one into a rule in the file that governs it, and adds a CALIBRATION.md row when a plan finished. Proposes first and applies only what the user approves. Use at the end of a session, after a plan's last session, or when the user says retro.
argument-hint: [plan path, when a plan just finished]
disable-model-invocation: true
---

Plan: $ARGUMENTS

A retro is useful only if the same mistake becomes cheaper to catch next time. Every proposal must change a file that a future session loads or runs. Never write a "lessons learned" note.

## 1. Collect (from this conversation, no new research)

List each mistake once, with evidence. Sources:

- user corrections and rejected proposals;
- `check-rules.sh` firings and `check` or `finish` FAIL lines, plus finish's "Needs judgment";
- packages that failed acceptance, were retried or escalated, or reported CONCERNS;
- the plan's `log.md` deviations (read `log.md` alone; it holds every session's outcome, so no session file is needed);
- work redone, reverted or thrown away;
- estimates that missed by one size or more;
- token waste: run `node scripts/agent-tokens.mjs` (current session) and take agents flagged over budget, files read more than once, and the largest tool results.

Skip one-off typos and mistakes that were caught and fixed by an existing check or rule. Those mean the system worked.

## 2. Sort

| Kind | Test | Becomes |
|---|---|---|
| Mechanical | A regex or a `git`/`jq` probe on the diff would have caught it, with no false positive on the current tree | a check in `.claude/hooks/check-rules.sh` plus a fixture case in `check-rules.test.sh` |
| Judgment | Catching it needs reading or deciding | one rule sentence in the file that governs the moment it happened: `AGENTS.md` (code), `CLAUDE.md` (routing, session), a skill or agent file (its step), or a `feedback` memory (a user preference that is not a repo rule) |
| Estimate | Size or session count missed | the CALIBRATION row and bias line (step 4) |

Before proposing anything, check that it is not already there: `grep` the target file for the pattern or the rule's key words. If a rule exists and was ignored, propose sharpening or moving it (to the step where it was needed) instead of adding a second one. Prefer deleting or tightening a rule over adding one.

## 3. Propose (one message, then wait)

```
## Retro — <session or plan>
Mistakes: <n> (mechanical <a>, judgment <b>, estimate <c>)

Checks (check-rules.sh):
C1 <mistake, evidence> → `<pattern or probe>` → message: "<hook line>" · fixture: <bad line> / <clean line>
Rules:
R1 <mistake, evidence> → <file>§<section>: "<exact sentence>" (add | sharpen | move from <file>)
Calibration:
<the row, if a plan finished>
Not proposed: <mistake — why: one-off, already caught, or no file would change>
```

Keep it to 40 lines or fewer. Then stop and wait. Applying anything needs the user's explicit approval, per item or "all".

## 4. Apply (approved items only)

- **Checks.** Add the probe to `check-rules.sh`, following its pattern (count in the working tree vs `HEAD`, one `problems+=` line naming the AGENTS.md section), and add a failing and a clean fixture to `check-rules.test.sh`. Run `bash .claude/hooks/check-rules.test.sh`. All cases pass, or the check is not added.
- **Rules.** Edit the one sentence in place. Follow `AGENTS.md` §5: present tense, no history language, and each fact in one place.
- **Calibration.** When a plan finished, add its row to `documents/plans/CALIBRATION.md` (estimated size and sessions, sessions used, real time from the first `log.md` line to the last, real size, why they differed), drop rows beyond 20, and rewrite the bias line from all rows.

Reply with what was applied, one line each, and the test result.
