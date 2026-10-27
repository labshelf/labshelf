/** Pins the exact HTML each bundle-backed webview page produces, so moving the skeleton into renderHtmlShell stays byte-identical. */
import * as vscode from "vscode";
import { listPanelHtml } from "../../src/libraryUi/listPanelHtml";
import { searchHtml } from "../../src/writing/search/view";
import { registerSyncGuideCommand } from "../../src/library/syncGuide/registerSyncGuideCommand";
import { AllProjectsPanel } from "../../src/writing/projects/allProjects";
import { HistoryPanel } from "../../src/writing/history/historyPanel";
import { GalleryPanel } from "../../src/writing/templates/gallery";

jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  createNonce: () => "NONCE",
  serveAllProjects: jest.fn(() => jest.fn()),
  createGalleryHost: jest.fn(() => ({ handle: jest.fn(), dispose: jest.fn(), isReady: () => false, openPublish: jest.fn() })),
  createPublishHost: jest.fn(() => ({})),
}));

const flush = () => new Promise((resolve) => setImmediate(resolve));
const extensionUri = vscode.Uri.file("/ext");
const logger = { log: jest.fn(), error: jest.fn() } as never;
const lastPanel = () => (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)!.value;

/** The page every site renders: title, stylesheet and script differ, and images may also come from data: URIs. */
function page(title: string, folder: string, name: string, dataImages = false): string {
  const images = dataImages ? " img-src vscode-resource: data:;" : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-NONCE'; style-src vscode-resource:;${images} font-src vscode-resource:;"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${title}</title>
<link rel="stylesheet" href="vscode-resource:/ext/dist/${folder}/${name}.css"/>
</head>
<body>
<div id="root"></div>
<script nonce="NONCE" type="module" src="vscode-resource:/ext/dist/${folder}/${name}.js"></script>
</body>
</html>`;
}

beforeEach(() => {
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
});

describe("bundle-backed webview pages", () => {
  it("sync guide", async () => {
    const context = { extensionUri, subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    registerSyncGuideCommand(context, () => undefined);
    const open = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([id]) => id === "labshelf.syncGuide")![1];
    await open();
    expect(lastPanel().webview.html).toBe(page("Sync guide", "syncGuide", "syncGuide"));
  });

  it("library list, sidebar and details", async () => {
    const webview = vscode.window.createWebviewPanel("t", "t", 1, {}).webview;
    expect(await listPanelHtml(webview, extensionUri)).toBe(page("LabShelf", "library", "library", true));
    expect(await listPanelHtml(webview, extensionUri, "sidebar")).toBe(page("LabShelf", "library", "sidebar", true));
    expect(await listPanelHtml(webview, extensionUri, "details")).toBe(page("LabShelf", "library", "details", true));
  });

  it("project search", async () => {
    const webview = vscode.window.createWebviewPanel("t", "t", 1, {}).webview;
    expect(await searchHtml(webview, extensionUri)).toBe(page("Project Search", "search", "search"));
  });

  it("all projects", async () => {
    AllProjectsPanel.open(extensionUri, {} as never, logger, { onSelect: jest.fn(), onActivate: jest.fn() }, jest.fn());
    await flush();
    expect(lastPanel().webview.html).toBe(page("All projects", "projects", "projects"));
  });

  it("history", async () => {
    const project = { settings: { id: "p" }, folder: "/p" } as never;
    await HistoryPanel.open(extensionUri, project, {} as never, logger, jest.fn());
    expect(lastPanel().webview.html).toBe(page("History", "history", "history"));
  });

  it("template gallery", async () => {
    GalleryPanel.open({ context: { extensionUri }, logger, sources: [], publish: {} } as never, jest.fn());
    await flush();
    expect(lastPanel().webview.html).toBe(page("Templates", "templates", "templates", true));
  });
});
