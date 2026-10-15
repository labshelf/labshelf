---
name: health
description: Full health audit of the LabShelf monorepo against AGENTS.md — compile, tests, oversized files and directories, boundary violations, duplication across apps, dead code, stale docs, history language. Produces a report; changes nothing.
context: fork
agent: general-purpose
model: sonnet
effort: medium
background: false
---

Run from the repo root and report each section. Do not fix anything.

1. **Compile and tests**: `pnpm -r typecheck`, `pnpm -r test`.
2. **Oversized files** (source > 300, tests > 500):
   `find packages -path '*/node_modules' -prune -o -path '*/dist' -prune -o -path '*/out' -prune -o -path '*/coverage' -prune -o \( -name '*.ts' -o -name '*.css' \) -print | xargs wc -l | sort -rn | awk '$1 > 300 && $2 != "total"'`
3. **Crowded directories**: directories under `packages/*/src` with more than 8 source files directly inside (excluding `index.ts`).
4. **Boundaries**: `pnpm exec depcruise packages/*/src --config .dependency-cruiser.cjs --no-ignore-known` covers app-to-app and core-to-app imports, deep imports past an `index.ts`, and `node:` imports in runtime-neutral core. Report the violations outside the baseline (`pnpm lint:deps`) separately from the known ones. Grep only what it does not cover:
   - packages other than core/vscode/browser/terminal under `packages/`
   - DOM globals in runtime-neutral core code (outside `node/` and `dom/` folders)
5. **Duplication across apps**: `pnpm jscpd` (gated against its committed baseline; `pnpm exec jscpd --reporters console` lists the clones), plus the `code-mapper` approach on suspicious pairs (same function names in two apps: `grep -rhoE "export (async )?function [A-Za-z]+" packages/*/src | sort | uniq -d`).
6. **Dead code**: `pnpm knip` (gated against its committed baseline; `pnpm exec knip` lists the findings), otherwise delegate to the `dead-code-cleaner` agent in report-only mode.
7. **Design system**: hard-coded colours in app CSS/TS (`grep -rnE "#[0-9a-fA-F]{3,8}\b" packages/{vscode,browser,terminal}/src --include='*.css' --include='*.ts'`), icon sets outside core, emoji in UI strings.
8. **Docs**: links in `documents/` and `README.md` that point to missing files; history language (`grep -rniE "no longer|previously|used to|legacy|formerly|was replaced|backward compat" documents AGENTS.md README.md`); `@depends`/`@usedBy` headers left in code.
9. **Agents and skills**: `bash .claude/skills/health/lint-skills.sh` (frontmatter, line limits, referenced paths and history language in `.claude/agents` and `.claude/skills`); report each line it prints.
10. **Refactor progress**: unticked steps in `documents/plans/architecture-refactor.plan.md`, if it still exists.

Report sections: Compile & tests · Oversized files · Crowded directories · Boundaries · Duplication · Dead code · Design system · Docs · Agents and skills · Refactor progress. Each item with path and the rule it breaks.
