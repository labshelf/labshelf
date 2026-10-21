// Tracks Space editor panel identity and active Research chat context.
import * as vscode from "vscode";
import { SPACE_TABS, type SpaceTab } from "@labshelf/core";
import type { SpacesService } from "../host/index.js";
import { SpacesPanel } from "./spacesPanel.js";

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
