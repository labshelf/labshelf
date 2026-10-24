# Rules for changes

Read when you write, review or plan code, UI or docs. Fetch one section with `node scripts/doc.mjs rules#<section>`; lint and the hooks enforce everything a machine can check.

## Placement

- Code that another app could run, unchanged or through an injected port, goes in `packages/core`. An app holds only its wiring and adapters for APIs only it has. Two apps never hold copies of the same code. Details: `architecture#packages`.
- On-disk formats and cross-app behaviour are contracts in `documents/contracts/`; change them together with the code. LabShelf is unpublished and no user data exists, so formats are replaced without migrations.

## Code

- Build only what the request needs: reuse what the codebase, the platform or an installed dependency already does before writing code. Never cut corners on trust-boundary validation, data loss, security or accessibility.
- Logic, formats, sync, contracts and data-loss paths ship with a test that fails without the change. UI layout, CSS and copy need no test.
- Log important actions and every failure through the injected `ILogger`, with enough context to diagnose. Never swallow an error.
- Comments explain why, not what. A comment may carry one tag: `TRAP:`, `INVARIANT:`, `PLATFORM:` or `CONTRACT: documents/contracts/<file>.md#<anchor>`.
- Delete what a change makes unused, in the same change: code, tests, settings, docs. Git keeps the history.
- Commands: `pnpm --filter @labshelf/<pkg> typecheck|test|build`, and `pnpm lint` for every structural check.

## UI

- UI that exists in two apps is a core component. Colours, fonts and spacing come from the core `--ls-*` tokens and icons from the core icon set (`architecture#design-system`).
- UI text says folder, paper, Unread / Reading / Done. UX principles: `product#ux-principles`.

## Docs

- `documents/` holds only what the code cannot say: contracts, rules, product principles, verification recipes and active plans.
- Update the affected doc in the same change as the code. Docs describe what is, never what was, and each fact lives in one place.
- Read docs one section at a time with `node scripts/doc.mjs`; a whole-file Read of `documents/` is denied outside `plans/`.
