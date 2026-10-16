sha: 25a7770
files: packages/vscode/src/writing/**, packages/vscode/src/activation/registration/registerWritingView.ts, packages/vscode/package.json, packages/core/src/writing/project/**, packages/core/src/writing/projectData/**, packages/core/src/library-ui/**, packages/core/src/ui/**
source: Explore scout, 2026-10-16

# The Projects view today
- It is the native tree view `labshelf.writing` ("Writing"), one of three tree views in activity-bar container labshelfContainer (vscode/package.json:337-360; viewsWelcome 377-379 with New project / Add existing folder; view/title menus 427-437). Provider: vscode/src/writing/projectsTreeProvider.ts; composition: vscode/src/activation/registration/registerWritingView.ts:~127-160. No writing webview exists: the gallery is a new webview (editor panel opened from the view, or a `type: "webview"` view). writing-project-workspace is rewriting this side bar — check its current form before designing (Q4).
- New project: vscode/src/writing/projectCommands.ts:23-35 — host.require(), showInputBox title, quick pick LaTeX/Typst, projects.data.createProject, reload, openProjectMain. Always <library>/projects/<id>/.
- core/src/writing/project/node/projectCatalog.ts:46-62 createProject: claim id, non-recursive mkdir, write main (writeFileAtomic), write labshelf.yaml LAST (keeps a half-written project unlisted), log "project created". Port: core/src/writing/projectData/projectDataPort.ts:14-35 createProject(libraryRoot,{title,format}) only; node impl projectData/node/nodeProjectData.ts via vscode/src/activation/node/nodeAdapters.ts:25. Multi-file needs a new request shape with relative-path validation.
- templates.ts projectTemplate(format,title) -> {main,text}; tests core/__tests__/writing/project/templates.test.ts. The blank templates become built-in gallery entries; the gallery replaces pickFormat so there is one way to create a project (AGENTS.md §4).
- projectFile.ts: PROJECT_FORMATS latex|typst, PROJECT_FILE labshelf.yaml.

# Reusable UI
- Webview recipe: vscode/src/ui/list/listWebviewPanel.ts:1-45, listPanelHtml.ts, src/libraryWebview/{main,webviewChannel}.ts (CSP, nonce, bundle in dist/library, typed messages).
- core/src/library-ui/dom/shell/frame.ts + sash.ts (sidebar/detail panes); mountLibraryUi is paper-specific.
- Protocol pattern: core/src/library-ui/protocol/{messages,transport,loopbackTransport,messageGuards}.ts, contract documents/contracts/library-ui-host.md. Gallery needs its own message union + guards.
- core/src/ui/dom/widgets/: showMenu, showDialog, confirmDialog, quickPick, inputBox, toast, overlay. Tokens core/src/ui/dom/tokens.css; icons core/src/ui/icons/{glyphs.ts,icon.ts} (FOLDER, BOOK, SHEET, SHEET_TALL, PANEL; check for a grid glyph). No card/grid component exists: new core dom component.
- Docs: documents/apps/vscode.md:28-36 (Writing view).
