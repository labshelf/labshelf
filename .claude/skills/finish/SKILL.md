---
name: finish
description: The finishing pass after a change — quality gate, delete what the change made unused, comment standard, docs in documents/, review. Two modes - finishing a plan session (before its commit, or before `plan close` for YAML sessions) and finishing a whole plan or standalone change. Runs on Sonnet in its own context, fixes mechanical issues itself and returns only what needs the main model's judgment. Use at the end of any session or change instead of doing these chores in the main thread.
argument-hint: session <session file> | plan <plan dir> | <brief of a standalone change>
context: fork
agent: finisher
model: sonnet
effort: medium
background: false
---

Args: $ARGUMENTS

Pick the mode from the args and read only its file:
- `session <documents/plans/<slug>/sessions/<file>>` (`.md` or `.yaml`) → [references/session.md](references/session.md): one plan session (`.md` before its commit; `.yaml` before `plan close`, which commits).
- `plan <documents/plans/<slug>>` → [references/plan.md](references/plan.md): the whole plan, after its last session.
- anything else, or nothing → a standalone change: run the steps of [references/session.md](references/session.md) and then those of [references/plan.md](references/plan.md) on the uncommitted change, with the args as the spec.

You work on the LabShelf repo following `documents/code.md`, `documents/product.md` and `documents/ui.md` (`node scripts/docs/doc.mjs <doc>#<anchor>`; read only the sections a step needs). Fix what is mechanical. Report what needs judgment. Do not change behaviour.

## Rules every mode uses

- **Gate.** `pnpm gate [pkg...]` prints only the errors and returns a cached PASS when the tree has not changed. Fix a failure with a mechanical cause (import path, missing export, stale snapshot); report a real bug instead of fixing it. If you edit source after the gate, run it again before reporting.
- **Deleting.** Before deleting anything, find uses with `node scripts/code/facts.mjs callers <name>` / `uses <file>`, then search every package (`src`, `__tests__`, manifests, `package.json`, HTML, CSS) and the dynamic uses knip misses: string-keyed message handlers, command ids, `import()`, esbuild entries, MV3 manifest entries. Keep and report code that looks like a workaround or carries a tag until `git log -S '<line>'` shows what it guards, and code that reads a format libraries on disk may still hold. Delete the code with its tests, fixtures, `index.ts` entries and doc mentions.
- **Comments.** Line 1 of a file header says what the file holds; why-comments carry only `TRAP:`, `INVARIANT:`, `PLATFORM:` or `CONTRACT:`, and a `CONTRACT:` anchor matches a heading in its doc; remove `@depends`/`@usedBy` lists, comments that restate the code, and history language; translate Portuguese to English. Never delete a tagged comment: tighten it, or report it as stale. Change comments only, never code.
- **Docs.** Present tense, no history, no listings of files or functions: do not document what the code says. Delete text about behaviour the code no longer has.
- **Review.** You cannot launch agents, so review the diff yourself on two axes and report them separately: **Standards** (placement and runtime boundaries; duplication with other apps; design-system use; every reader host handles new messages; behaviour changes have tests) and **Spec** (the acceptance the mode names; "no spec given" when there is none).

Return only this:

```
## Finish report (<session id | plan slug | change>)
Gate: PASS | FAIL (<what>)
Fixed: <one line per mechanical fix>
Deleted: <one line per deletion, with the evidence>
Docs: <files updated>
Review — Standards: <findings, or "clean">
Review — Spec: <met / unmet criteria, or "no spec given">
Needs judgment:
- file:line — <issue> — <suggested fix>
```

If nothing needs judgment, say "Needs judgment: none".
