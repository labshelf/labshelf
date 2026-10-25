// Tracks Space editor panel identity and active Research chat context.
import * as vscode from "vscode";
import {
  SPACE_TABS,
  type SpaceTab,
  serveSpaces,
  type ServeSpacesOptions,
  type SpacesEndpoint,
  type SpacesToHost,
  createNonce,
} from "@labshelf/core";
import type { SpacesService } from "../host/index.js";
import { labshelfTabIcon, bundleExists, bundleMissingHtml } from "../../ui/index.js";

interface SpacesView { view: "catalog" | "space"; id?: string; tab?: SpaceTab }
const spacesBundleDirectory = (extension: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(extension, "dist", "spaces");

async function spacesHtml(webview: vscode.Webview, extension: vscode.Uri, view: SpacesView): Promise<string> {
  const dir = spacesBundleDirectory(extension);
  const script = vscode.Uri.joinPath(dir, "spaces.js");
  if (!(await bundleExists(script))) {
    return bundleMissingHtml({ title: "Spaces", heading: "Spaces bundle not built", file: "dist/spaces/spaces.js", reopen: "Spaces" });
  }
  const nonce = createNonce();
  const config = JSON.stringify(view).replace(/</g, "\\u003c");
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="${csp}"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Spaces</title><link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(dir, "spaces.css"))}"/>
</head><body><div id="root"></div><script nonce="${nonce}" type="application/json" id="spaces-config">${config}</script>
<script nonce="${nonce}" type="module" src="${webview.asWebviewUri(script)}"></script></body></html>`;
}

type Binding = Omit<ServeSpacesOptions, "today">;
class SpacesPanel {
  private disposed = false;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly stop: () => void;
  readonly panel: vscode.WebviewPanel;

  constructor(extension: vscode.Uri, readonly view: SpacesView, title: string, binding: Binding, activate: () => void, close: () => void) {
    const panel = this.panel = vscode.window.createWebviewPanel("labshelfSpaces", title, vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [spacesBundleDirectory(extension)],
    });
    panel.iconPath = labshelfTabIcon(extension);
    const handlers = new Set<(message: SpacesToHost) => void>();
    const endpoint: SpacesEndpoint = {
      post: message => { if (!this.disposed) void panel.webview.postMessage(message); },
      subscribe: handler => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    };
    this.subscriptions.push(panel.webview.onDidReceiveMessage(raw => handlers.forEach(handler => handler(raw))));
    this.stop = serveSpaces(endpoint, { ...binding, today: () => new Date().toLocaleDateString("en-CA") });
    this.subscriptions.push(panel.onDidChangeViewState(activate), panel.onDidDispose(() => { this.dispose(); close(); }));
    void spacesHtml(panel.webview, extension, view).then(html => { if (!this.disposed) panel.webview.html = html; }).catch(error => {
      void binding.logger.log("ERROR", "spaces/panel", "Spaces page could not load", { view: view.view, id: view.id, error: String(error) });
      void vscode.window.showErrorMessage(`Could not open Spaces: ${String(error)}`);
    });
    void binding.logger.log("INFO", "spaces/panel", "Spaces panel opened", { view: view.view, id: view.id });
  }

  reveal(tab?: SpaceTab): void {
    this.panel.reveal(vscode.ViewColumn.One);
    if (tab) void this.panel.webview.postMessage({ type: "spaces.navigate", tab });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.panel.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

export class SpacesPanelRegistry implements vscode.Disposable {
  private readonly panels = new Map<string, SpacesPanel>();
  private readonly changed = new vscode.EventEmitter<string | null>();
  readonly onDidChangeContext = this.changed.event;
  private active: SpacesPanel | undefined;
  private name: string | null = null;
  private binding: ReturnType<SpacesService["current"]>;
  private stopStore: (() => void) | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly extension: vscode.Uri, private readonly spaces: SpacesService) {
    this.binding = spaces.current();
    this.bindStore();
    this.subscription = spaces.onDidChange(() => {
      if (this.binding !== spaces.current()) {
        this.closePanels(); this.binding = spaces.current(); this.bindStore();
      } else this.refresh();
    });
  }

  context(): string | null { return this.name; }

  open(id?: string, tab?: unknown): void {
    const binding = this.spaces.current();
    if (!binding) return;
    const key = id ?? "";
    const selected = SPACE_TABS.includes(tab as SpaceTab) ? tab as SpaceTab : undefined;
    const existing = this.panels.get(key);
    if (existing) { existing.reveal(selected); this.active = existing; this.updateContext(); return; }
    const row = id ? binding.store.list().find(row => row.state === "ready" && row.space.id === id) : undefined;
    if (id && (!row || row.state !== "ready")) return;
    const view = id ? { view: "space" as const, id, ...(selected ? { tab: selected } : {}) } : { view: "catalog" as const };
    const panel = new SpacesPanel(this.extension, view, row?.state === "ready" ? row.space.name : "All Spaces", binding,
      () => { if (panel.panel.active) this.active = panel; this.updateContext(); },
      () => { this.panels.delete(key); if (this.active === panel) this.active = undefined; this.updateContext(); });
    this.panels.set(key, panel); this.active = panel; this.updateContext();
  }

  private updateContext(): void {
    const next = this.active?.panel.active && this.active.view.view === "space" ? this.active.panel.title : null;
    if (this.name !== next) { this.name = next; this.changed.fire(next); }
  }

  private refresh(): void {
    const rows = this.binding?.store.list() ?? [];
    for (const panel of [...this.panels.values()]) {
      if (!panel.view.id) continue;
      const row = rows.find(row => row.state === "ready" && row.space.id === panel.view.id);
      if (!row) panel.dispose();
      else if (row.state === "ready") panel.panel.title = row.space.name;
    }
    this.updateContext();
  }

  private bindStore(): void { this.stopStore?.(); this.stopStore = this.binding?.store.onChange(() => this.refresh()); }
  private closePanels(): void { for (const panel of [...this.panels.values()]) panel.dispose(); this.panels.clear(); }
  dispose(): void { this.closePanels(); this.stopStore?.(); this.subscription.dispose(); this.changed.dispose(); }
}
