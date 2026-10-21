// Verifies Space panel identity, lifecycle and bundle failures.
import * as vscode from "vscode";
import { registerSpacesPanels } from "../../../src/spaces/panels/index";
import type { SpacesService } from "../../../src/spaces/host/index";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), serveSpaces: jest.fn(() => jest.fn()) }));
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const change = new vscode.EventEmitter<void>();
  let notify = () => {};
  let rows = [{ state: "ready", space: { id: "alpha", name: "Alpha" } }, { state: "ready", space: { id: "beta", name: "Beta" } }];
  const current = { store: { list: () => rows, onChange: (fn: () => void) => { notify = fn; return () => {}; } }, port: {}, logger: { log: jest.fn() } };
  let root: typeof current | undefined = current;
  const context = { extensionUri: vscode.Uri.file("/ext"), subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
  const source = registerSpacesPanels(context, { current: () => root, onDidChange: change.event } as unknown as SpacesService);
  const command = (id: string, ...args: unknown[]) => (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id)![1](...args);
  return { source, current, command, broadcast: () => change.fire(), rename: () => { rows[0]!.space.name = "Renamed"; notify(); }, remove: () => { rows = rows.slice(1); notify(); }, rootChange: () => { root = undefined; change.fire(); } };
}

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
});

test("opens a singleton catalog and one panel per Space, revealing repeated opens", () => {
  const h = setup();
  h.command("labshelf.spaces.all"); h.command("labshelf.spaces.all");
  h.command("labshelf.spaces.open", "alpha"); h.command("labshelf.spaces.open", "alpha"); h.command("labshelf.spaces.open", "beta");
  expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(3);
  const panels = (vscode.window.createWebviewPanel as jest.Mock).mock.results.map(result => result.value);
  expect(panels.map(panel => panel.title)).toEqual(["All Spaces", "Alpha", "Beta"]);
  expect(panels[0].reveal).toHaveBeenCalledTimes(1);
  expect(panels[1].reveal).toHaveBeenCalledTimes(1);
  h.source.dispose();
});

test("shows the bundle-missing page when the Spaces bundle is absent", async () => {
  (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("missing"));
  const h = setup(); h.command("labshelf.spaces.all"); await flush();
  const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
  expect(panel.webview.html).toContain("Spaces bundle not built");
  expect(panel.webview.html).toContain("dist/spaces/spaces.js");
  h.source.dispose();
});

test("refreshes titles and chat context, closes deleted Spaces and closes panels on root changes", () => {
  const h = setup(); h.command("labshelf.spaces.open", "alpha");
  const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
  expect(h.source.context()).toBe("Alpha");
  h.rename(); expect(panel.title).toBe("Renamed"); expect(h.source.context()).toBe("Renamed");
  panel._fireViewState({ active: false }); expect(h.source.context()).toBeNull();
  panel._fireViewState({ active: true }); expect(h.source.context()).toBe("Renamed");
  h.remove(); expect(panel.dispose).toHaveBeenCalled(); expect(h.source.context()).toBeNull();
  h.command("labshelf.spaces.all"); h.rootChange();
  expect((vscode.window.createWebviewPanel as jest.Mock).mock.results[1]!.value.dispose).toHaveBeenCalled();
  h.source.dispose();
});

test("keeps panels open when the active services broadcast a data change", () => {
  const h = setup(); h.command("labshelf.spaces.open", "alpha");
  const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
  h.broadcast(); expect(panel.dispose).not.toHaveBeenCalled();
  h.command("labshelf.spaces.open", "alpha", "papers");
  expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "spaces.navigate", tab: "papers" });
  h.source.dispose();
});
