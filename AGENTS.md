# LabShelf — rules for agents

LabShelf is a local-first research paper manager that ships as three apps of one product: a VS Code extension, a browser extension and a terminal app. Read [documents/README.md](documents/README.md) for where everything else is documented.

These rules apply to every change. When a rule and existing code disagree, the rule wins. Fix the code you touch, and do not copy the deviation.

## 1. Where code goes

The repository has four packages and nothing else under `packages/`:

| Package | Contains |
|---|---|
| `core` | everything that more than one app can use: domain logic, formats, sync, PDF pipeline, reader UI, design system, search |
| `vscode` | wiring for VS Code, plus code that exists only because it runs in VS Code |
| `browser` | wiring for the browser extension, plus code that exists only because it runs in a browser extension |
| `terminal` | wiring for the terminal app, plus code that exists only because it runs in a terminal |

To decide where new code goes, ask in order:

1. Could another app run it, unchanged or with an injected port? Put it in `core`.
2. Does it need an API that only one app has (`vscode`, `chrome.*`, IndexedDB, raw TTY, `node:sqlite`)? Put it in that app as an adapter that implements a core port.
3. Is it wiring: a composition root, command registration, or mapping UI events to core calls? Put it in the app.

More rules:

- **Apps never import each other.** An app imports only `core` and third-party packages.
- **Never copy code between apps.** If two apps need the same thing, it moves to `core` before the second copy exists.
- **Core is split by runtime.** Code at the root of a core domain folder is runtime-neutral: no `node:*`, no DOM, no `vscode`, no `chrome`. Node-only code lives in a `node/` subfolder (used by vscode and terminal). DOM-only code lives in a `dom/` subfolder (used by VS Code webviews and browser pages). See [documents/architecture.md](documents/architecture.md).
- **Platform access goes through ports.** Core declares an interface and the app implements it. Only the app's composition root instantiates adapters.
- **On-disk formats are contracts.** Change them only together with [documents/contracts/](documents/contracts/).

## 2. One product, one look

- Every colour, font, size, spacing, radius and shadow in any UI comes from the core design tokens. App CSS must not hard-code any of them.
- UI pieces that exist in two apps (lists, detail pane, menus, dialogs, toasts, quick input, reader) are core components. Apps add only host glue.
- Icons come from the core icon set as inline SVG. No emoji, and no Unicode symbols used as icons.
- UI text uses the product vocabulary: folder, paper, Unread / Reading / Done.
- UX principles: [documents/product.md](documents/product.md).

## 3. Size and shape

- **Climb the minimal-code ladder before writing anything:** needs to exist? → already in the codebase? → platform or stdlib does it? → an installed dependency does it? → one readable line is enough? → only then, the minimum code for it.
- **Never cut corners on trust-boundary validation, data-loss handling, security or accessibility.** The ladder does not excuse skipping these.
- **One responsibility per file.** You must be able to state it in one sentence without "and", and the file name must say it.
- **Source files stay at or under 200 lines, with a hard limit of 300.** Test files have a hard limit of 500. Past the limit, split by responsibility, not by line count.
- **Functions stay at or under 50 lines.** A longer function is doing more than one thing.
- **A directory holds at most 8 source files directly** (`index.ts` does not count). Past that, group the files into subfolders named by responsibility.
- **Every directory has an `index.ts`** that exports its public API. Code outside the directory imports from the index, never from its internal files.
- **Every file starts with a header comment of one or two lines** saying what the file is for. Do not add lists of dependents or dependencies (`@depends`, `@dependents`, `@usedBy`), because they go stale and the editor already knows them.
- **Names are descriptive, without `utils`, `helpers`, `misc`, `common` or `manager` grab-bags.** If a file needs one of those names, it has more than one responsibility.
- **Tests mirror `src/`** under `packages/<pkg>/__tests__/`.

## 4. Delete, do not keep

- **No speculative abstraction, option or config.** Build for the request in front of you, not a hypothetical future one.
- **No dependency for a few lines.** Add one only when hand-writing it would be longer or riskier than the dependency itself.
- **Delete unused code in the same change that makes it unused:** files, exports, functions, parameters, types, CSS rules, settings, commands, dependencies, feature flags, tests of deleted code and docs of deleted behaviour.
- **What is forbidden:**
  - commented-out code;
  - `old`, `legacy`, `v2`, `new`, `deprecated` or `compat` names;
  - re-exports kept for old import paths;
  - aliases kept "for compatibility";
  - fallbacks for code paths that no longer exist;
  - `TODO: remove`.
- **When you replace something, delete what it replaced in the same change.** Two implementations of one thing never coexist.
- **To check whether something is used,** search every package, including manifests, `package.json` contributions, HTML, CSS and build scripts. If nothing references it, delete it. Git keeps the history.
- **The one exception is user data.** Code that reads a format which libraries on users' disks or Drive may still contain stays until that format can no longer exist. It lives in a `migrations/` folder of its domain, and its header names the condition under which it is deleted.

## 5. Writing: docs, comments, commits

- **Describe what is, in the present tense.** Never describe what used to be. Do not write "now", "new", "no longer", "previously", "used to", "was replaced", "instead of the old", "legacy", "refactored to" or "changed from". Write "Sync keeps both copies on conflict", never "Sync now keeps both copies instead of overwriting".
- **Comments explain why, not what.** Write them only for intent, a non-obvious constraint or a trap. A comment that repeats the code or the signature must not exist.
- **A file header's first line is a capability sentence:** a self-contained verb + object, no file name — e.g. `// Searches papers by fuzzy title match.`, not `// searchByText.ts`.
- **A why-comment may carry one tag, and tags appear nowhere else:** `TRAP:` for a non-obvious gotcha (`// TRAP: CrossRef returns 200 with an empty list on a miss.`); `INVARIANT:` for a condition the code relies on (`// INVARIANT: ids are sorted ascending.`); `PLATFORM:` for a pdf.js, MV3, VS Code or TTY quirk (`// PLATFORM: MV3 service workers cannot hold an IndexedDB connection open.`); `CONTRACT: documents/contracts/<file>.md#<anchor>` for a cross-app contract (`// CONTRACT: documents/contracts/sync.md#conflict-resolution`).
- **Docs hold only what the code cannot say:** contracts between apps, architecture rules, product principles, setup, and how to verify. Never document file lists, function lists or constants.
- **Each fact lives in one place.** Link to it instead of repeating it.
- **Update docs in the same change as the code.** Delete docs of removed behaviour; do not mark them as outdated.
- **Use English** for code, comments, docs and commit messages.
- **Plans** are directories (`plan.md`, `sessions/`, `log.md`, `research/`) that follow [documents/plans/TEMPLATE/](documents/plans/TEMPLATE/plan.md) and live in `documents/plans/<slug>/` while they are being executed. When a plan is done, delete its directory. Move it to `documents/archive/` only if it meets the bar in [documents/archive/README.md](documents/archive/README.md).

## 6. Behaviour

- Logic, formats, sync, contracts and data-loss paths ship with a test that fails without it. UI layout, CSS, copy and simple glue need no test; the user checks them by hand. Do not run `verify` unless asked.
- Log important actions and every failure through the injected `ILogger`, with enough context to diagnose without a debugger. Log fallbacks explicitly, and do not log in hot paths.
- Errors carry context. Never swallow an error silently; log it or surface it.
- Replies end with what was not checked, not just what passed.

## 7. Commands

```bash
pnpm install
pnpm -r typecheck            # all packages
pnpm -r test                 # all packages
pnpm --filter @labshelf/<pkg> test
pnpm --filter @labshelf/<pkg> build
```

Before finishing a change:

1. Typecheck and test every package you touched, plus `core` if you changed it.
2. Check the size and shape limits on the files you touched.
3. Delete what your change made unused.
4. Update the affected doc in `documents/`.

How to run and verify each app for real (extension host, headless browser, terminal frames): [documents/apps/README.md](documents/apps/README.md#verifying-changes).
