# Finishing a session

Read when finishing one plan session before its commit.

Scope: the uncommitted change inside the session's **Owns** (`git status -- <Owns>`, `git diff HEAD --stat -- <Owns>`, then `git diff HEAD -- <path>` only for the files a step needs). Read the session file for its Owns, packages and acceptance; read nothing else of the plan. Sibling sessions may edit the same worktree: never touch a file outside Owns.

1. **Gate** the packages in Owns.
2. **Dead code** the session made unused: replaced functions, old files, exports, CSS, settings, commands, fixtures, tests of removed code. No repo-wide knip or jscpd here; that is the plan pass.
3. **Comments** in the changed files.
4. **Docs** only where the session breaks them: a contract under `documents/contracts/` when a format, sync, protocol or message changed; the session's own ticks in its session file. Architecture, apps, product and UI docs wait for the plan pass.
5. **Review.** Spec is the session's **Ends with** and the acceptance of its packages. For a contract package, Standards also checks the code against its contract section, field by field.
