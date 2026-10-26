# UI and UX

Read when you design or change a visible surface in an app. Not for the website.

LabShelf is one product in three hosts. Good UI here is consistent with what already exists, not distinctive. Every design choice traces to one of the principles below.

## Principles

1. **Paper-first, not a file explorer.** Zotero is the reference. Folders are for navigation and papers are the content, so a list shows papers only and never mixes folder rows into it. Folder structure appears as a path header, chips or a separate pane. Avoid file-manager idioms such as an "up" button or Backspace to go to the parent folder.
2. **Fluid navigation over features.** Navigating never rebuilds a view. Selection, scroll position and search survive a folder change. State is pushed to an open view rather than the view being reloaded.
3. **Abstract first.** The detail pane leads with what helps decide whether to read: title, authors, venue, abstract, then actions.
4. **Keyboard everywhere.** Every action has a key. The reader offers optional vim keys, and the terminal follows yazi's columns and keys while keeping Zotero's pane model (folders | papers | preview).
5. **Never lose the user's work.** LabShelf never deletes a file because of something it cannot explain. Destructive actions ask for confirmation.
6. **Redesign within the structure.** A redesign polishes the existing structure (pane dividers, sortable column headers, tree twisties on the left) instead of stripping it; familiar structure is what makes the UI unambiguous.
7. **Preview-led templates.** The gallery gives document previews the main area. Sources, search and filters support browsing without a second navigation pane. Template details put the preview and the choice to create a project before technical metadata.

## Where things are

- **Tokens:** data in `packages/core/src/ui/tokens/`, rendered into `packages/core/src/ui/dom/tokens.css` as `--ls-*` properties by `pnpm --filter @labshelf/core tokens`. Never edit `tokens.css` by hand. A missing value is a new token in the data, not a literal in app CSS.
- **Components:** `packages/core/src/ui/dom/` (button, menu, dialog, toast, quick input, settings rows) and `packages/core/src/libraryUi/dom/` (library list and detail pane). Reuse one before you write markup.
- **Icons:** `packages/core/src/ui/icons/`, a Feather-based inline-SVG set. A missing icon is added there, in the same style.
- **Reader:** `packages/core/src/reader/`, whose page themes come from the same tokens.
- **Terminal:** maps the colour roles onto the 16 ANSI colours. It has no SVG icons, so it uses plain text there.

## How to design

1. Find the closest surface that already exists in any app and start from its structure. Two apps showing the same thing use the same core component, and the apps add only host glue.
2. Use the product words from [product.md](product.md#general) exactly: folder, paper, Unread / Reading / Done. Use no synonyms.
3. Design the states as well as the happy path: empty, loading, error, long titles, narrow width, light and dark, keyboard focus. Accessibility is not optional.
4. Describe the design in the plan step as the components, the tokens and the states. Do not use pixel values or colours.

The user checks a surface by hand in light and dark; `/verify` takes screenshots only when they ask. The `check-rules` hook and `pnpm lint` catch hard-coded values and size limits, not whether the UI looks right.
