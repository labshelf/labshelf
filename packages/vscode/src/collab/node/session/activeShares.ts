// Tracks the shares connected in this window and tells views when one opens, closes, or its peers or state change.
import * as vscode from "vscode";

import type { ShareConnection, ShareConnections } from "@labshelf/core";

/** What else runs while a share is connected, such as the editor binding; disposed when it closes. */
type OnOpen = (share: ShareConnection) => vscode.Disposable;

export class ActiveShares implements ShareConnections, vscode.Disposable {
  private readonly open = new Map<string, { share: ShareConnection; attached: vscode.Disposable }>();
  private readonly busy = new Set<string>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly onOpen: OnOpen) {}

  list(): ShareConnection[] {
    return [...this.open.values()].map(({ share }) => share);
  }

  active(shareId: string): ShareConnection | undefined {
    return this.open.get(shareId)?.share;
  }

  /** True while a share, join or leave of the share runs; the project list then lags behind and must not be acted on. */
  isBusy(shareId: string): boolean {
    return this.busy.has(shareId);
  }

  async hold<T>(shareId: string, task: () => Promise<T>): Promise<T> {
    this.busy.add(shareId);
    try {
      return await task();
    } finally {
      this.busy.delete(shareId);
    }
  }

  add(share: ShareConnection): void {
    const fire = () => this.changeEmitter.fire();
    // The state covers the session status, the relay, storage health and the mirror.
    const stopState = share.onStateChange(fire);
    const stopPeers = share.session.onPeer(fire);
    const attached = vscode.Disposable.from(this.onOpen(share), { dispose: () => { stopState(); stopPeers(); } });
    this.open.set(share.shareId, { share, attached });
    fire();
  }

  /** Disconnects the share; its files and stored state stay. Rejects when the close leaves an update unstored. */
  async remove(shareId: string): Promise<void> {
    const entry = this.open.get(shareId);
    if (!entry) { return; }
    this.open.delete(shareId);
    entry.attached.dispose();
    this.changeEmitter.fire();
    await entry.share.close();
  }

  dispose(): void {
    [...this.open.keys()].forEach((shareId) => void this.remove(shareId));
    this.changeEmitter.dispose();
  }
}
