---
name: ui-design
description: Design or change UI in the LabShelf apps (VS Code webviews, browser extension pages, reader, terminal) so it stays one product with one look — core tokens, core components and icons, product vocabulary. Use for any step that adds or reshapes a visible surface in an app. Not for the website.
argument-hint: <the surface and what should change>
---

Surface: $ARGUMENTS

LabShelf is one product in three hosts. Good UI here is consistent with what already exists, not distinctive. Read these before you design anything:

1. `node scripts/doc.mjs rules#ui` — the rules: tokens only, shared components in core, core icons, product vocabulary.
2. `node scripts/doc.mjs product#ux-principles` — the UX principles. Every design choice must trace to one of them.
3. `node scripts/doc.mjs architecture#design-system` — where tokens, components, icons and reader themes live and how each host maps them.

## Where things are

- **Tokens:** data in `packages/core/src/ui/tokens/`, rendered into `packages/core/src/ui/dom/tokens.css` as `--ls-*` properties by `pnpm --filter @labshelf/core tokens`. Never edit `tokens.css` by hand. A missing value is a new token in the data, not a literal in app CSS.
- **Components:** `packages/core/src/ui/dom/` (button, menu, dialog, toast, quick input, settings rows) and `packages/core/src/library-ui/dom/` (library list and detail pane). Reuse one before you write markup.
- **Icons:** `packages/core/src/ui/icons/`, a Feather-based inline-SVG set. A missing icon is added there, in the same style.
- **Reader:** `packages/core/src/reader/`, whose page themes come from the same tokens.
- **Terminal:** maps the colour roles onto the 16 ANSI colours. It has no SVG icons, so it uses plain text there.

## How to design

1. Find the closest surface that already exists in any app and start from its structure. Two apps showing the same thing use the same core component, and the apps add only host glue.
2. Use the product words exactly: folder, paper, Unread / Reading / Done. Use no synonyms.
3. Design the states as well as the happy path: empty, loading, error, long titles, narrow width, light and dark, keyboard focus. Accessibility is not optional.
4. Describe the design in the plan step as the components, the tokens and the states. Do not use pixel values or colours.

## How to check

The user checks the surface by hand in light and dark; suggest `/verify` only if they ask for screenshots. `check` catches token drift and size limits. It cannot tell you whether the UI looks right.
