# Finishing a session

Read when finishing one plan session. A legacy `.md` session is finished before its commit; a YAML session (`sessions/<id>.yaml`) is finished before `plan close`, which commits.

Scope: the uncommitted change inside the session's **Owns** (`git status -- <Owns>`, `git diff HEAD --stat -- <Owns>`, then `git diff HEAD -- <path>` only for the files a step needs). Read the session file for its Owns, packages and acceptance; read nothing else of the plan. Sibling sessions may edit the same worktree: never touch a file outside Owns.

For a YAML session, read the packages (spec ids, `goal`, `acceptance`, `seams`) from the session file and the matching `plan.yaml`, and each package's result from `.git/labshelf-runs/<plan>/<id>.report.yaml`. Do not commit and do not delete the session file: `plan close` does both. Steps 1 to 4 are the same, except that ticks go to the session's package `status`, which `plan close` sets, not to you.

1. **Gate** the packages in Owns. With `gate: lint milestone` in the args, run the full `pnpm gate`, `node scripts/lint/modules.mjs --update`, `pnpm jscpd:update-baseline` and `pnpm lint`, and fix what they report, including what earlier sessions left; never grow a baseline to pass. Report a fix that needs judgment (a split by concept, a module move, a merge of duplicates) instead of guessing it.
2. **Dead code** the session made unused: replaced functions, old files, exports, CSS, settings, commands, fixtures, tests of removed code. No repo-wide knip or jscpd here; that is the plan pass.
3. **Comments** in the changed files.
4. **Docs** only where the session breaks them: a contract under `documents/contracts/` when a format, sync, protocol or message changed; the session's own ticks in its session file. Architecture, apps, product and UI docs wait for the plan pass.
5. **Review.** Spec is the session's **Ends with** (`.md`) or its `goal` (YAML), and the acceptance of its packages (for YAML, the `acceptance` ids of each spec, checked against its `report.yaml` entries; flag a `pass` the diff does not support). For a contract package, Standards also checks the code against its contract section, field by field.
