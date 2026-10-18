# Session 6 — the workspace shell of the library page

- **Goal:** a core DOM editor area (tabs, two groups, sash) and the browser library page rebuilt around it, with the sidebar flow of VS Code, hash restore and the sidebar-section setting.
- **Starts from:** session 5 committed (session 2's core moves in place).
- **Ends with:** A1, A2 (with a placeholder source tab and an empty preview tab), A3, A10.
- **Owns:** `packages/core/src/library-ui/dom/editorArea/`, `packages/browser/src/library-page/`, `packages/browser/src/options/` (sidebar sections only), their tests.

Facts: `documents/plans/browser-project-workspace/research/vscode-flow.md` (flow, core sidebar, browser page today) and `research/core-reuse.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 6.1 | Core editor area | behaviour | main thread with the `ui-design` skill (opus) | component renders tabs and two groups with core tokens | [ ] |
| 6.2 | Library page composition | behaviour | implementer (opus) | A1, A2, A3 headless | [ ] |
| 6.3 | Sidebar sections setting | behaviour | implementer (sonnet) | A10 | [ ] |
| 6.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 6.1 — Core editor area

- **Read only:** `packages/core/src/library-ui/dom/shell/frame.ts:48-76`; `packages/core/src/library-ui/dom/mountLibraryUi.ts:47-77`; `packages/core/src/library-ui/dom/sidebar/mountLibrarySidebar.ts:36-44`; the core tokens and icon set index (`packages/core/src/library-ui/dom/` design tokens).
- **Decided:** `mountEditorArea(slot, {onActivate, onClose, onMove})` → `{open(tab, group?), close(id), activate(id), tabs(), split()}`; a tab is `{id, title, icon, group: 0|1, dirty?, mount(el) → {dispose()}}`; tab bodies mount lazily on first activation and `dispose` runs on close (D9); a group with no tabs disappears; the sash width is stored in prefs like the frame widths. Keyboard: Ctrl/Cmd+W closes, Ctrl+Tab cycles; tabs are a `tablist` with roving focus. No hard-coded colours or sizes.
- **Done when:** a jsdom test pins open/activate/close/dispose and group collapse; tokens only.

## 6.2 — Library page

- **Read only:** `packages/browser/src/library-page/main.ts:32-59`, `router.ts`, `sidebar/sidebarTree.ts:10-39`, `sidebar/sidebarProjects.ts`; `packages/vscode/src/writing/session/projectSession.ts:46-98`; `packages/core/src/library-ui/dom/sidebar/sidebarProjects.ts:8-45`.
- **Decided:** the Library tab hosts `mountLibraryUi` without its sidebar; the sidebar mounts once at page level with `ALL_PROJECT_OFFERS`. Tabs: Library, All projects (core `mountAllProjects` over core `serveAllProjects` and session 2's core `createProjectLibrary` with `openLabel: "Open"`), Templates (core `mountTemplateGallery` with Community and My templates over `LibraryFileSystem`; Typst Universe through the helper when connected), source and preview tabs (placeholders filled in session 7). Each tab body is a dynamic `import()` chunk. Open/close follow `projectSession.ts`: opening a different project closes the current one; close aborts if a dirty tab cancels. The hash is `#/tabs/<encoded tab ids>[;active=<id>]`; `#/papers/...` opens the Library tab at that paper. Files / Outline / Checklist panes render the core nodes from session 2 in `setOpenProject`.
- **Done when:** headless Chrome for Testing run (`documents/apps/README.md#verifying-changes`) shows A1–A3; browser typecheck and test.
- **Do not touch:** `packages/browser/src/editor/` (deleted in session 10), `src/helper/`.

## 6.3 — Sidebar sections

- **Read only:** `packages/browser/src/options/index.ts`; the browser prefs storage module it uses; `packages/browser/src/library-page/main.ts` after 6.2.
- **Decided:** setting `sidebarSections: {library: boolean, projects: boolean}`, default both on, at least one on; the page reads it before mounting and never imports the hidden section's chunk.
- **Done when:** A10 observed headless (network list shows no project chunk).
