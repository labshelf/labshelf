# Finishing a session

Read when finishing one plan session. A legacy `.md` session is finished before its commit; a YAML session (`sessions/<id>.yaml`) is finished before `plan close`, which commits.

Scope: the uncommitted change inside the session's **Owns** (`git status -- <Owns>`, `git diff HEAD --stat -- <Owns>`, then `git diff HEAD -- <path>` only for the files a step needs). With `changed: <files>` in the args (a resumed session whose earlier pass already finished), steps 2 to 5 cover only those files. Read the session file for its Owns, packages and acceptance; read nothing else of the plan. Sibling sessions may edit the same worktree: never touch a file outside Owns.

For a YAML session, read the packages (spec ids, `goal`, `acceptance`, `seams`) from the session file and the matching `plan.yaml`, and each package's result from `.git/labshelf-runs/<plan>/<id>.report.yaml`. Do not commit and do not delete the session file: `plan close` does both. Steps 1 to 4 are the same, except that ticks go to the session's package `status`, which `plan close` sets, not to you.

The session is a **lint milestone** when the args say `gate: lint milestone` or the YAML session has `milestone: true`. Any other session gets the short pass: its gate and review stay proportional to its diff.

1. **Gate**, last, after every edit of steps 2 to 4: `plan close` reuses a pass recorded for the exact tree and runs the gate again otherwise.
   - Short pass: `pnpm gate --no-lint`, which runs typecheck and tests of only the packages the change touches (`packages/<pkg>/`; core pulls in the apps). No lint, no baseline updates.
   - Lint milestone: the full `pnpm gate`, `node scripts/lint/modules.mjs --update`, `pnpm jscpd:update-baseline` and `pnpm lint`, and fix what they report, including what earlier sessions left; never grow a baseline to pass. Report a fix that needs judgment (a split by concept, a module move, a merge of duplicates) instead of guessing it.
2. **Dead code** the session made unused: replaced functions, old files, exports, CSS, settings, commands, fixtures, tests of removed code. No repo-wide knip or jscpd here; that is the plan pass.
3. **Comments** in the changed files.
4. **Docs** only where the session breaks them: a contract under `documents/contracts/` when a format, sync, protocol or message changed; the session's own ticks in its session file. Architecture, apps, product and UI docs wait for the plan pass.
5. **Review.** Spec is the session's **Ends with** (`.md`) or its `goal` (YAML), and the acceptance of its packages (for YAML, the `acceptance` ids of each spec, checked against its `report.yaml` entries; flag a `pass` the diff does not support).
   - Short pass: read the session diff once and report blocking issues only: behaviour that misses the spec or acceptance, a broken contract (`documents/contracts/`), dead code the session left. Standards reports only those; no architecture, placement or style review.
   - Lint milestone: the full review of both axes. For a contract package, Standards also checks the code against its contract section, field by field.
6. **Record** (YAML): when the gate passed and nothing needs judgment, run `node scripts/plans/plan.mjs finished <session>` as the very last command. It stores the tree state in `.git/labshelf-runs/<plan>/<session>.finished`, so a resumed session goes straight to `plan close`.
