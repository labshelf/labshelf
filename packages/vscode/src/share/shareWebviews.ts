// Keeps the webviews that show the sharing dialogs, serves each of them once serving starts, and hands the Library sidebar the dialog to open.
import * as vscode from "vscode";

import { isShareMessage, type ShareDialogRequest, type ShareReply } from "@labshelf/core";

type ServeOn = (webview: vscode.Webview) => vscode.Disposable;

interface Attached {
  webview: vscode.Webview;
  opensDialogs: boolean;
  /** The dialog webview posts hello once its script listens, so an open request never races it. */
  ready: boolean;
  served: vscode.Disposable | undefined;
}

const LIBRARY_VIEW_FOCUS = "labshelf.library.focus";

const isHello = (raw: unknown): boolean => isShareMessage(raw) && (raw as { type?: unknown }).type === "hello";

export class SharingWebviews {
  private readonly attached = new Set<Attached>();
  private serveOn: ServeOn | undefined;
  private pending: ShareDialogRequest | undefined;

  /** `opensDialogs` marks the webview that open requests go to. Serving waits for `serve`, which the web build never calls. */
  attach(webview: vscode.Webview, { opensDialogs = false }: { opensDialogs?: boolean } = {}): vscode.Disposable {
    const entry: Attached = { webview, opensDialogs, ready: false, served: this.serveOn?.(webview) };
    this.attached.add(entry);
    const hello = opensDialogs
      ? webview.onDidReceiveMessage((raw: unknown) => { if (isHello(raw)) { entry.ready = true; this.flush(); } })
      : undefined;
    return new vscode.Disposable(() => {
      this.attached.delete(entry);
      hello?.dispose();
      entry.served?.dispose();
    });
  }

  serve(serveOn: ServeOn): vscode.Disposable {
    this.serveOn = serveOn;
    for (const entry of this.attached) { entry.served ??= serveOn(entry.webview); }
    return new vscode.Disposable(() => {
      this.serveOn = undefined;
      for (const entry of this.attached) { entry.served?.dispose(); entry.served = undefined; }
    });
  }

  /** Reveals the Library sidebar and opens the dialog there; a request made before the sidebar is ready replaces any earlier one. */
  async open(request: ShareDialogRequest): Promise<void> {
    this.pending = request;
    await vscode.commands.executeCommand(LIBRARY_VIEW_FOCUS);
    this.flush();
  }

  private flush(): void {
    const target = [...this.attached].find((entry) => entry.opensDialogs && entry.ready);
    const request = this.pending;
    if (!target || !request) { return; }
    this.pending = undefined;
    const reply: ShareReply = { channel: "sharing", type: "open", request };
    // A webview that cannot take the message keeps the request for its next hello.
    void target.webview.postMessage(reply).then((delivered) => { if (!delivered) { this.pending ??= request; } });
  }
}

export const sharingWebviews = new SharingWebviews();
