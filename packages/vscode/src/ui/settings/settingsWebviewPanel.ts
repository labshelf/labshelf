/**
 * Manages the LabShelf settings editor tab: it shows the current library root and Google
 * Drive connection state, and delegates every action back to the commands and callbacks
 * owned by the composition root.
 */
import * as vscode from "vscode";
import type { SyncController } from "../../sync/adapter/syncController.js";
import { labshelfTabIcon } from "../tabIcon.js";
import { buildSettingsHtml } from "./settingsHtml.js";

export interface SettingsPanelOptions {
  /** Current library root, or null while no library is configured. */
  getLibraryRoot: () => vscode.Uri | null;
  /** Active sync controller, or null while Drive sync has not been set up. */
  getSyncController: () => SyncController | null;
  /** Runs the library setup wizard and resolves to the new root, or undefined if cancelled. */
  reconfigureLibrary: () => Promise<vscode.Uri | undefined>;
}

export class SettingsWebviewPanel {
  public static currentPanel: SettingsWebviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _options: SettingsPanelOptions;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Reveals the existing settings panel if one is open, or creates a new one.
   * @usedBy extension.ts (labshelf.openSettings)
   * @returns void
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    options: SettingsPanelOptions,
  ): void {
    if (SettingsWebviewPanel.currentPanel) {
      SettingsWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      SettingsWebviewPanel.currentPanel._render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "labshelfSettings",
      "LabShelf Settings",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );
    panel.iconPath = labshelfTabIcon(extensionUri);

    SettingsWebviewPanel.currentPanel = new SettingsWebviewPanel(panel, options);
  }

  private constructor(panel: vscode.WebviewPanel, options: SettingsPanelOptions) {
    this._panel = panel;
    this._options = options;

    this._panel.webview.onDidReceiveMessage(
      (msg: Record<string, unknown>) => this._handleMessage(msg),
      null,
      this._disposables,
    );
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    const controller = options.getSyncController();
    if (controller) {
      this._disposables.push(controller.onDidChangeStatus(() => this._render()));
    }

    this._render();
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg["command"]) {
      case "library.reconfigure":
        await this._options.reconfigureLibrary();
        break;
      case "sync.connect":
        await vscode.commands.executeCommand("labshelf.sync.connect");
        break;
      case "sync.now":
        await vscode.commands.executeCommand("labshelf.sync.now");
        break;
      case "sync.disconnect":
        await vscode.commands.executeCommand("labshelf.sync.disconnect");
        break;
      case "settings.openNative":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "labshelf",
        );
        break;
      default:
        return;
    }
    this._render();
  }

  private _render(): void {
    const root = this._options.getLibraryRoot();
    const controller = this._options.getSyncController();
    this._panel.webview.html = buildSettingsHtml({
      libraryRoot: root ? root.fsPath : null,
      connected: controller?.isConnected() ?? false,
      syncing: controller?.isSyncing() ?? false,
      lastSync: controller?.getLastSyncTime() ?? null,
    });
  }

  /**
   * Disposes the panel and every subscription held by it.
   * @usedBy vscode WebviewPanel onDidDispose
   * @returns void
   */
  public dispose(): void {
    SettingsWebviewPanel.currentPanel = undefined;
    this._panel.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
