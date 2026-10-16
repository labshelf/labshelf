// Holds the list panel's host-to-UI messages until the webview reports ready, then sends them in order.
import type { HostToUi } from '@labshelf/core';

// The state push on ready resends these with fresh values, so a held copy would only overwrite them with stale ones.
const RESENT_ON_READY: ReadonlySet<HostToUi['type']> = new Set(['snapshot', 'navigate', 'jobs', 'sidecarChanged']);

export class ReadyQueue {
  private _ready = false;
  private _closed = false;
  private _held: HostToUi[] = [];

  constructor(private readonly _send: (message: HostToUi) => Thenable<unknown>) {}

  get ready(): boolean {
    return this._ready;
  }

  async post(message: HostToUi): Promise<void> {
    if (this._closed) { return; }
    if (this._ready) { await this._send(message); return; }
    if (!RESENT_ON_READY.has(message.type)) { this._held.push(message); }
  }

  /** From here on messages go straight to the webview. */
  markReady(): void {
    this._ready = true;
  }

  /** Sends what was held before ready; called after the state push so the UI already has the library. */
  async flush(): Promise<void> {
    const held = this._held;
    this._held = [];
    for (const message of held) { await this.post(message); }
  }

  /** Drops what is held; the webview is gone. */
  close(): void {
    this._closed = true;
    this._held = [];
  }
}
