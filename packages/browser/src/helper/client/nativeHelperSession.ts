// Maintains authenticated helper sessions for an extension page.
import { type HelperStatus, type ToPageMessage } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import { handshake } from "./handshake";
import type { HelperConnection, HelperPortFactory, HelperWebSocketConstructor } from "./connection";
import type { EditTracker } from "./project";

export interface NativeHelperSessionDeps {
  logger: ILogger;
  extensionVersion: string;
  origin: string;
  connectNative: HelperPortFactory;
  webSocket?: HelperWebSocketConstructor;
}

interface Session { native: HelperConnection; socket: HelperConnection }

export class NativeHelperSession {
  status: HelperStatus | undefined;
  private session: Session | undefined;
  private generation = 0;
  private connecting: Promise<HelperStatus> | undefined;

  constructor(private readonly deps: NativeHelperSessionDeps, private readonly edits: EditTracker) {}

  private drop(reason: string | undefined, generation: number): void {
    if (generation !== this.generation) return;
    const dropped = this.session;
    this.session = undefined;
    this.status = undefined;
    dropped?.native.disconnect();
    dropped?.socket.disconnect();
    void this.deps.logger.log("INFO", "browser.helper", "LabShelf Helper connection closed", { reason });
  }

  disconnect(): void { this.drop("disconnected by the page", this.generation); this.generation++; }

  private resendStale(message: Extract<ToPageMessage, { type: "error" }>): void {
    const resend = message.code === "stale" && message.id !== undefined ? this.edits.resend(message.id) : undefined;
    if (!resend) {
      void this.deps.logger.log("WARN", "browser.helper", "LabShelf Helper reported an error no request was waiting for", { code: message.code, message: message.message });
      return;
    }
    void this.deps.logger.log("INFO", "browser.helper", "Resending the whole text after a stale edit", { projectId: resend.projectId, path: resend.path });
    try { this.session?.socket.post({ type: "edit", ...resend }); }
    catch (error) { void this.deps.logger.error("browser.helper", error, { operation: "resend", projectId: resend.projectId, path: resend.path }); }
  }

  // INVARIANT: overlapping requests share one handshake because open projects belong to one socket.
  connect(): Promise<HelperStatus> {
    this.connecting ??= this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async open(): Promise<HelperStatus> {
    const mine = ++this.generation;
    const previous = this.session;
    this.session = undefined;
    previous?.native.disconnect();
    previous?.socket.disconnect();
    const outcome = await handshake({ ...this.deps, webSocket: this.deps.webSocket ?? globalThis.WebSocket }, {
      onUnmatchedError: (message) => this.resendStale(message), onClose: (reason) => this.drop(reason, mine),
    });
    if (mine !== this.generation) {
      outcome.native?.disconnect(); outcome.socket?.disconnect();
      throw new Error("LabShelf Helper connection was cancelled");
    }
    this.edits.forgetAll();
    this.status = outcome.status;
    this.session = outcome.native && outcome.socket ? { native: outcome.native, socket: outcome.socket } : undefined;
    return this.status;
  }

  async readySocket(): Promise<HelperConnection> {
    if (!this.session) await this.connect();
    if (!this.session || this.status?.state !== "ready") {
      if (this.status?.state === "not-installed") throw new Error("Install LabShelf Helper to build and publish projects.");
      if (this.status?.state === "update-extension") throw new Error("Update the LabShelf browser extension to connect to this Helper.");
      if (this.status?.state === "update-helper") {
        const host = this.status.host === "vscode" ? "the VS Code extension" : this.status.host === "terminal" ? "the terminal app" : "LabShelf Helper";
        throw new Error(`Update ${host} to connect the browser to its Helper.`);
      }
      throw new Error("LabShelf Helper is not connected. Try again.");
    }
    return this.session.socket;
  }
}
