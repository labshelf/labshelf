# Checking Spaces

Read when checking Spaces by hand in VS Code and the browser. Run each check in both apps unless it names one host. These checks require human inspection; automated tests do not establish visual acceptance.

## Setup

Follow [setup and verification isolation](README.md#verifying-changes). Use a scratch library containing several papers with different reading statuses and a writing project with checklist items and a target deadline. Keep a copy to compare paper and project files after destructive actions.

- VS Code: `pnpm --filter @labshelf/vscode build`, then open the repository and press F5. Configure the Extension Development Host to use the scratch library ([extension host run](vscode.md#extension-host-run)).
- Browser: `pnpm --filter @labshelf/browser build`, load the unpacked extension and open its Library page ([load](browser.md#load)). Point it at the same scratch library through a picked folder or the bridge. A separate browser-storage library cannot demonstrate cross-app file refresh. The [headless recipe](browser.md#headless-run) supports inspection, but calendar import and theme appearance require manual checks.

## Functional checks

1. **Create (A1).** Create one Space from the sidebar and another from the catalog. Check their names appear in both surfaces and each has `spaces/<id>/space.json` under the scratch library.
2. **References (A2).** Use a paper's Add to Space… menu and the Papers tab's Add papers control. Put the same paper in both Spaces; compare `papers/` with the scratch copy to confirm no copy or move.
3. **Folders (A3).** Create nested Space folders, rename one, and move a reference into it. Delete the child folder: its reference moves to the parent. Check the sidebar matches Papers after each action.
4. **Removal (A4).** Remove a reference, then delete a disposable Space. Check the paper remains in Library, the project remains intact and the Space directory goes to trash.
5. **Dates and goals (A5).** Add a task, deadline, read goal and project goal, with dates on both sides of today. Tick the task. Mark a goal's paper Done and complete a project checklist item; check progress follows. Check the linked project's target deadline and the Today marker. Export `.ics` and import it into a calendar to inspect titles and dates.
6. **Projects (A6).** Link a project and inspect its format, main file, deadline and checklist progress. Open it from the Space, then unlink it; check the normal project still opens independently.
7. **Focus (A7).** Mark and unmark a paper in focus from Papers. Check Overview follows and shows its reading status.
8. **Catalog (A8).** Search, switch All / Personal / Shared, and inspect reading progress, next date, paper and project counts, and You. Shared shows its empty state. Open a Space and check the catalog stays open.
9. **Glossary (A9).** Add, edit and delete terms with optional symbols and paper/page sources. Reload and check persistence. Give two terms the same symbol and check both show a conflict notice.
10. **Positioned screens (A10).** Inspect Notes, Discussions, Discover, Research chat, Share, Members, Since your last visit and Glossary suggestions. Notes, Discussions and Discover show an availability notice. Unavailable controls explain the missing capability; Members shows You. Inspect network activity while interacting with these controls: no capability request leaves the app.
11. **Missing references (A11).** In the scratch files, add an unresolved paper id and project id. Check Not in your Library / Not on this device with Remove. Reload without removing them and confirm the ids remain on disk; then remove them through the UI.
12. **Conflict copies (A12, VS Code).** Create conflict copies of both Space files using the [supported names](../contracts/library-format.md#conflict-copies). Run Resolve Conflicting Copies; test Keep mine and Keep the other with distinct scratch values. Check the selected content survives and Keep both is absent.
13. **Outside edits (A13).** Keep a Space open, then edit its name and glossary in the scratch files or through the other app. Check VS Code refreshes. Return to the browser page and check it refreshes, including the catalog and sidebar.

## Appearance and keyboard (A14)

Check light and dark themes, narrow panels, visible focus, sidebar navigation and activation, and the six inner tabs using the keyboard. Inspect tree and tab roles in the accessibility tree. Compare the page proportions, catalog rows, underline tabs and two-column Overview panels with the [mockup](../ideas/spaces-mockup/index.html), using the host’s Library and Projects themes. Inspect the creation empty state and editable Space identity. Add a paper from Overview. Open a focused paper by clicking its row. Check that the view tabs stay visible while scrolling, each tab restores its reading position, and activating the current tab preserves an open draft. Inspect the Projects, Papers in focus and Members column beside Dates and goals, Discussions and Since your last visit. Collaboration placeholders explain their missing capability. Confirm that long names remain identifiable, controls remain reachable at narrow widths and reduced-motion preferences disable transitions. Inspect row actions with a pointer, keyboard focus and touch input. Tokens and icon reuse also require source review. Inspect each host's [Spaces checks](browser.md#checking-spaces) for tab restoration and Research chat pane behaviour.
