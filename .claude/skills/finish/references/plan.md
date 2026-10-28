# Finishing a plan

Read when finishing a whole plan after its last session, or a standalone change after the session steps.

Scope: for a plan, every commit since the plan directory was added (`base=$(git log --format=%H --diff-filter=A -1 -- <plan dir>/plan.md)`, then `git diff $base^ --stat`), plus anything uncommitted. For a standalone change, the uncommitted change. Read `plan.md` for its goal and acceptance; not `log.md` or session files.

1. **Gate** the packages in scope.
2. **Dead code across the repo.** Run `pnpm knip` and `pnpm jscpd` from the repo root (gated against committed baselines; a nonzero exit is a finding). Look for duplication between what different sessions added. When the jscpd count drops, run `pnpm jscpd:update-baseline`.
3. **Docs.** Update the `documents/` files the whole change affects (`node scripts/docs/doc.mjs` lists them): `code.md`, `product.md`, `ui.md`, contracts the sessions missed. Mark the plan done (`Status: done` in `plan.md`; `status: done` in `plan.yaml`).
4. **Review.** Standards on the whole scope, looking for what no single session could see: the same thing solved twice, an app that diverged from the others, a contract that drifted from its doc. Spec is the plan's acceptance (the A-ids in `plan.md`), or the args for a standalone change.
