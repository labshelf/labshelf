// Scripts a LabShelf Helper behind a fake native port and a fake socket transport so helper client tests run without a browser.
import { PROTOCOL_VERSION, type HelperBuildState, type TexToolchain, type HelperTransport } from "../../src/helper/index";
import type { ILogger, NativeMessagePort } from "../../src/ports/index";

/** `announce` replaces the offsets the helper declares, to script a lying helper. */
export interface PagesScript { pageCount: number; pages: Array<{ index: number; bytes: Uint8Array }>; announce?: Array<{ index: number; offset: number; length: number }> }
const SHA = "a".repeat(64);
type Envelope = Record<string, any>;
const NO_PAYLOAD = new Uint8Array(0);

/** The socket side of the fake helper; `sent` records every message the client posted with its payload. */
export class FakeSocket implements HelperTransport {
  closed = false;
  readonly sent: Array<{ message: Envelope; payload: Uint8Array }> = [];
  private messageListener: (message: unknown, payload: Uint8Array) => void = () => undefined;
  private closeListener: (reason: string | undefined) => void = () => undefined;
  constructor(readonly url: string, private readonly helper: FakeHelper) {}
  post(message: object, payload?: Uint8Array): void {
    this.sent.push({ message: message as Envelope, payload: payload ?? NO_PAYLOAD });
    this.helper.answer(this, message as Envelope);
  }
  onMessage(listener: (message: unknown, payload: Uint8Array) => void): void { this.messageListener = listener; }
  onClose(listener: (reason: string | undefined) => void): void { this.closeListener = listener; }
  close(): void { this.closed = true; }
  deliver(body: Envelope, payload?: Uint8Array): void { this.messageListener({ v: PROTOCOL_VERSION, ...body }, payload ?? NO_PAYLOAD); }
  serverClose(reason: string): void { this.closeListener(reason); }
}

/** Plays the helper: answers hello on the native port and every other message on the socket. */
export class FakeHelper implements NativeMessagePort {
  protocol = PROTOCOL_VERSION;
  tex: TexToolchain = { source: "tinytex", year: 2025, complete: true };
  built: { status: HelperBuildState; pages?: PagesScript } = { status: "failed" };
  /** Answers `edit` messages that carry `changes` with a `stale` error. */
  staleChanges = false;
  /** Answers `hello` with a `version` error that carries this `v`, as a helper of that protocol does. */
  refuseHelloWithV: number | undefined;
  /** Leaves `hello` unanswered, so a test can close the port while it is pending. */
  muteHello = false;
  readonly nativePosted: Envelope[] = [];
  readonly received: Envelope[] = [];
  readonly sockets: FakeSocket[] = [];
  private messageListener: (frame: unknown) => void = () => undefined;
  private disconnectListener: (reason: string | undefined) => void = () => undefined;

  /** Opens a socket transport as the browser's WebSocket does once open. */
  readonly openSocket = async (url: string): Promise<HelperTransport> => {
    const socket = new FakeSocket(url, this);
    this.sockets.push(socket);
    return socket;
  };

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
      if (this.refuseHelloWithV !== undefined) {
        reply({ v: this.refuseHelloWithV, type: "error", code: "version", message: `v is ${PROTOCOL_VERSION}, expected ${this.refuseHelloWithV}` });
        return;
      }
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
}

export function fakeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) } as unknown as ILogger & { log: jest.Mock; error: jest.Mock };
}
