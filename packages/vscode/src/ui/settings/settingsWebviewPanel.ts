/**
 * Opens the LabShelf settings editor tab. The shell is set once; the host sends the page its state when it says ready and
 * on every change, and the page posts the actions back.
 */
import * as vscode from "vscode";
import type { DriveStatus, ILogger } from "@labshelf/core";
import { labshelfTabIcon } from "../tabIcon.js";
import type { SettingsHostMessage, SettingsState } from "./protocol.js";
import { handleSettingsMessage } from "./settingsMessages.js";
import { settingsBundleDirectory, settingsShellHtml } from "./settingsShell.js";

const LOG_MODULE = "settings";
const NOT_SET_UP: DriveStatus = { connected: false, syncing: false, lastSyncTime: null, lastError: null };

export interface SettingsPanelOptions {
  /** Current library root, or null while no library is configured. */
  getLibraryRoot: () => vscode.Uri | null;
  /** Null while Drive sync has not been set up. */
  getDriveStatus: () => DriveStatus | null;
  /** Fires when the Drive status may have changed, including when sync is set up after the panel opened. */
  onDidChangeDriveStatus: vscode.Event<void>;
  /** Runs the library setup wizard and resolves to the new root, or undefined if cancelled. */
  reconfigureLibrary: () => Promise<vscode.Uri | undefined>;
  /** The library's logger, or undefined while no library is configured. */
  getLogger: () => ILogger | undefined;
}

export class SettingsWebviewPanel {
  public static currentPanel: SettingsWebviewPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static createOrShow(extensionUri: vscode.Uri, options: SettingsPanelOptions): void {
    const current = SettingsWebviewPanel.currentPanel;
    if (current) {
      current.panel.reveal(vscode.ViewColumn.One);
      current.postState();
      return;
    }
    const panel = vscode.window.createWebviewPanel("labshelfSettings", "LabShelf Settings", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [settingsBundleDirectory(extensionUri)],
    });
    panel.iconPath = labshelfTabIcon(extensionUri);
    SettingsWebviewPanel.currentPanel = new SettingsWebviewPanel(panel, extensionUri, options);
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly options: SettingsPanelOptions,
  ) {
    // The shell is rendered once the bundle check returns; a panel closed meanwhile keeps its blank page.
    void settingsShellHtml(panel.webview, extensionUri).then((html) => {
      if (SettingsWebviewPanel.currentPanel === this) { panel.webview.html = html; }
    });
    panel.webview.onDidReceiveMessage((raw: unknown) => this.receive(raw), null, this.disposables);
    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.disposables.push(options.onDidChangeDriveStatus(() => this.postState()));
  }

  private receive(raw: unknown): void {
    handleSettingsMessage(raw, {
      postState: () => this.postState(),
      reconfigureLibrary: () => this.options.reconfigureLibrary(),
      executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
      warn: (message, context) => this.log("WARN", message, context),
    }).catch((error: unknown) => {
      const logger = this.options.getLogger();
      if (logger) { void logger.error(LOG_MODULE, error, { op: "settings action" }); } else { console.error("LabShelf settings action failed", error); }
    });
  }

  // Without a library there is no logger yet; the extension host console is the fallback.
  private log(level: "WARN", message: string, context: Record<string, unknown>): void {
    const logger = this.options.getLogger();
    if (logger) { void logger.log(level, LOG_MODULE, message, context); } else { console.warn(`LabShelf: ${message}`, context); }
  }

  private postState(): void {
    const root = this.options.getLibraryRoot();
    const state: SettingsState = { libraryRoot: root ? root.fsPath : null, sync: this.options.getDriveStatus() ?? NOT_SET_UP };
    const message: SettingsHostMessage = { type: "state", state };
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    const owned = this.disposables.splice(0);
    // panel.dispose() raises onDidDispose, which calls back here.
    if (owned.length === 0) { return; }
    SettingsWebviewPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of owned) { d.dispose(); }
  }
}
