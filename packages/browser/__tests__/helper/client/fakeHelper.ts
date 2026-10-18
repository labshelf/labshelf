// Scripts a LabShelf Helper behind a fake native port and a fake WebSocket class so client tests run without a browser.
import { decodeSocketMessage, encodeSocketMessage, PROTOCOL_VERSION, type HelperBuildStatus, type TexStatus } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import type { HelperWebSocketConstructor } from "../../../src/helper/client/connection";
import type { NativePort } from "../../../src/platform";

/** `announce` replaces the offsets the helper declares, to script a lying helper. */
export interface PagesScript { pageCount: number; pages: Array<{ index: number; bytes: Uint8Array }>; announce?: Array<{ index: number; offset: number; length: number }> }
const SHA = "a".repeat(64);
type Envelope = Record<string, any>;

export class FakeSocket {
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string, private readonly helper: FakeHelper) { queueMicrotask(() => this.onopen?.()); }
  send(bytes: Uint8Array): void { this.helper.answer(this, decodeSocketMessage(bytes).envelope); }
  close(): void { this.closed = true; }
  deliver(body: Envelope, payload?: Uint8Array): void {
    const bytes = encodeSocketMessage({ v: PROTOCOL_VERSION, ...body }, payload);
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  serverClose(reason: string): void { this.onclose?.({ code: 1006, reason }); }
}

/** Plays the helper: answers hello on the native port and every other message on the socket. */
export class FakeHelper implements NativePort {
  protocol = PROTOCOL_VERSION;
  tex: TexStatus = { source: "tinytex", year: 2025, complete: true };
  built: { status: HelperBuildStatus; pages?: PagesScript } = { status: "failed" };
  /** Answers `edit` messages that carry `changes` with a `stale` error. */
  staleChanges = false;
  /** Leaves `hello` unanswered, so a test can close the port while it is pending. */
  muteHello = false;
  readonly nativePosted: Envelope[] = [];
  readonly received: Envelope[] = [];
  readonly sockets: FakeSocket[] = [];
  private messageListener: (frame: unknown) => void = () => undefined;
  private disconnectListener: (reason: string | undefined) => void = () => undefined;
  readonly socketClass = this.makeSocketClass();

  onMessage(listener: (frame: unknown) => void): void { this.messageListener = listener; }
  onDisconnect(listener: (reason: string | undefined) => void): void { this.disconnectListener = listener; }
  disconnect(): void { /* the test closes through closeNative() */ }
  closeNative(reason?: string): void { this.disconnectListener(reason); }
  receivedOfType(type: string): Envelope[] { return this.received.filter((m) => m.type === type); }

  post(frame: unknown): void {
    const message = frame as Envelope;
    this.nativePosted.push(message);
    if (this.muteHello) { return; }
    const reply = (body: Envelope) => this.messageListener({ v: PROTOCOL_VERSION, id: message.id, ...body });
    queueMicrotask(() => {
      reply({ type: "ready", host: "helper", protocol: this.protocol, helperVersion: "1.0.0", tex: this.tex });
      if (this.protocol === PROTOCOL_VERSION) { reply({ type: "session", port: 4321, token: "secret" }); }
    });
  }

  answer(socket: FakeSocket, m: Envelope): void {
    this.received.push(m);
    const reply = (body: Envelope, payload?: Uint8Array) => socket.deliver({ id: m.id, ...body }, payload);
    queueMicrotask(() => {
      if (m.type === "auth") { reply({ type: "authed" }); }
      else if (m.type === "openProject") { reply({ type: "opened", projectId: m.projectId, files: ["main.tex"] }); }
      else if (m.type === "edit" && this.staleChanges && m.changes) { reply({ type: "error", code: "stale", message: "version gap" }); }
      else if (m.type === "compile") { this.answerCompile(reply); }
    });
  }

  private answerCompile(reply: (body: Envelope, payload?: Uint8Array) => void): void {
    reply({ type: "progress", phase: "building", message: "Running pdflatex", fraction: 0.5 });
    const pages = this.built.pages;
    reply({ type: "built", status: this.built.status, problems: [], ...(pages ? { pdfSha256: SHA } : {}) });
    if (!pages) { return; }
    let offset = 0;
    const changed = pages.pages.map((p) => { const entry = { index: p.index, offset, length: p.bytes.length }; offset += p.bytes.length; return entry; });
    const payload = new Uint8Array(offset);
    changed.forEach((entry, i) => payload.set(pages.pages[i]!.bytes, entry.offset));
    reply({ type: "pages", pdfSha256: SHA, pageCount: pages.pageCount, changed: pages.announce ?? changed }, payload);
  }

  private makeSocketClass(): HelperWebSocketConstructor {
    const helper = this;
    return class extends FakeSocket {
      constructor(url: string) { super(url, helper); helper.sockets.push(this); }
    } as unknown as HelperWebSocketConstructor;
  }
}

export function fakeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}
