// Connects a page to LabShelf Helper over two transports: id-paired requests, the protocol version check and the handshake that opens a session.
import { isHostNotFound } from "../bridge/index.js";
import { toError } from "../errors/index.js";
import type { ILogger, NativeMessagePort } from "../ports/index.js";
import { HELPER_HOST_NAME, PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "./helperMessages.js";
import type { HelperState } from "./helperPaths.js";
import { parseHelperMessage } from "./parseHelperMessage.js";

/** A message in, a message out: `payload` carries the raw bytes that follow a socket envelope and is empty on the native port. */
export interface HelperTransport {
  post(message: object, payload?: Uint8Array): void;
  onMessage(listener: (message: unknown, payload: Uint8Array) => void): void;
  onClose(listener: (reason: string | undefined) => void): void;
  close(): void;
}

export type HelperPortFactory = () => NativeMessagePort;
/** Resolves once the socket at `url` is open; rejects when it closes first. */
export type HelperSocketOpener = (url: string) => Promise<HelperTransport>;

const NO_PAYLOAD = new Uint8Array(0);

function createNativeTransport(port: NativeMessagePort): HelperTransport {
  return {
    post: (message) => port.post(message),
    onMessage: (listener) => port.onMessage((frame) => listener(frame, NO_PAYLOAD)),
    onClose: (listener) => port.onDisconnect(listener),
    close: () => port.disconnect(),
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<ToHelperMessage, "v" | "id">;
/** Returns `{ done }` to settle the request with a value, or undefined to wait for more messages. */
export type FrameStep<T> = (message: ToPageMessage, payload: Uint8Array) => { done: T } | undefined;
type ErrorMessage = Extract<ToPageMessage, { type: "error" }>;

export class HelperClosedError extends Error {
  constructor(message: string, readonly reason: string | undefined) { super(message); }
}

/** The helper refused or sent a message of another protocol version; `helperProtocol` is the `v` it carried, when it carried a number. */
export class HelperVersionError extends Error {
  constructor(readonly helperProtocol: number | undefined) {
    super(`LabShelf Helper speaks protocol ${helperProtocol ?? "unknown"}, this page speaks ${PROTOCOL_VERSION}`);
  }
}

export interface ConnectionHooks {
  /** An `error` that answers no pending request, such as `stale` for an `edit`. */
  onUnmatchedError?: (message: ErrorMessage) => void;
  onClose?: (reason: string | undefined) => void;
}

interface Pending { type: string; step: FrameStep<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void }

const MODULE = "browser.helper.connection";

export class HelperConnection {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly channel: HelperTransport, private readonly logger: ILogger, private readonly hooks: ConnectionHooks = {}) {
    channel.onMessage((message, payload) => this.receive(message, payload));
    channel.onClose((reason) => this.close(reason));
  }

  get isOpen(): boolean { return !this.closed; }

  /** Sends a message no reply answers, such as `cancel`, and returns its id. */
  post(body: RequestBody, payload?: Uint8Array): string {
    if (this.closed) { throw new HelperClosedError(`LabShelf Helper is not connected (${body.type})`, undefined); }
    const id = String(this.nextId++);
    this.channel.post({ v: PROTOCOL_VERSION, id, ...body }, payload);
    return id;
  }

  request<T>(body: RequestBody, step: FrameStep<T>): Promise<T> {
    if (this.closed) { return Promise.reject(new HelperClosedError(`LabShelf Helper is not connected (${body.type})`, undefined)); }
    return new Promise<T>((resolve, reject) => {
      const id = String(this.nextId);
      this.pending.set(id, { type: body.type, step, resolve: resolve as (value: unknown) => void, reject });
      try {
        this.post(body);
      } catch (error) {
        this.pending.delete(id);
        reject(error as Error);
      }
    });
  }

  disconnect(): void {
    if (this.closed) { return; }
    this.channel.close();
    this.close("disconnected by the page");
  }

  private close(reason: string | undefined): void {
    if (this.closed) { return; }
    this.closed = true;
    for (const [id, pending] of this.pending) {
      pending.reject(new HelperClosedError(`LabShelf Helper closed the connection while request ${id} (${pending.type}) was pending: ${reason ?? "no reason given"}`, reason));
    }
    this.pending.clear();
    this.hooks.onClose?.(reason);
  }

  private receive(raw: unknown, payload: Uint8Array): void {
    const parsed = parseHelperMessage(raw, "toPage");
    if (!parsed.ok) {
      void this.logger.log("WARN", MODULE, "Dropped an unreadable helper message", { code: parsed.code, reason: parsed.reason });
      const error = parsed.code === "version"
        ? new HelperVersionError(parsed.received)
        : new Error(`LabShelf Helper sent an unreadable message (${parsed.code}): ${parsed.reason}`);
      this.settleError(parsed.id, error);
      return;
    }
    const message = parsed.message;
    const pending = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!pending || message.id === undefined) {
      if (message.type === "error") { this.hooks.onUnmatchedError?.(message); }
      return;
    }
    if (message.type === "error") {
      this.settleError(message.id, message.code === "version"
        ? new HelperVersionError(message.v)
        : new Error(`LabShelf Helper refused ${pending.type} (${message.code}): ${message.message}`));
      return;
    }
    try {
      const step = pending.step(message, payload);
      if (step) { this.pending.delete(message.id); pending.resolve(step.done); }
    } catch (error) {
      this.settleError(message.id, toError(error));
    }
  }

  private settleError(id: string | undefined, error: Error): void {
    const pending = id === undefined ? undefined : this.pending.get(id);
    if (!pending || id === undefined) { return; }
    this.pending.delete(id);
    pending.reject(error);
  }
}

/** The helper's `v` is all a refusal tells, so a missing or lower one means the helper is older. */
function deriveVersionErrorStatus(error: HelperVersionError, pageProtocol: number): HelperState {
  const protocol = error.helperProtocol;
  if (protocol !== undefined && protocol > pageProtocol) { return { state: "update-extension", protocol }; }
  return { state: "update-helper", protocol: protocol ?? 0, host: undefined };
}

export function deriveHelperStatus(ready: Extract<ToPageMessage, { type: "ready" }>, pageProtocol: number): HelperState {
  if (ready.protocol < pageProtocol) { return { state: "update-helper", protocol: ready.protocol, host: ready.host }; }
  if (ready.protocol > pageProtocol) { return { state: "update-extension", protocol: ready.protocol }; }
  return { state: "ready", helperVersion: ready.helperVersion, tex: ready.tex, host: ready.host, ...(ready.python && { python: ready.python }) };
}

export interface HandshakeDeps {
  logger: ILogger;
  extensionVersion: string;
  origin: string;
  connectNative: HelperPortFactory;
  openSocket: HelperSocketOpener;
}

export interface Handshake { status: HelperState; native?: HelperConnection; socket?: HelperConnection }

type Ready = Extract<ToPageMessage, { type: "ready" }>;
type Session = Extract<ToPageMessage, { type: "session" }>;

function failureReason(error: unknown): string | undefined {
  return error instanceof HelperClosedError ? error.reason : error instanceof Error ? error.message : undefined;
}

/** Settles with the ready message alone when the protocols differ, since no session follows it. */
function helloStep() {
  let ready: Ready | undefined;
  return (message: ToPageMessage): { done: { ready: Ready; session?: Session } } | undefined => {
    if (message.type === "ready") {
      ready = message;
      return message.protocol === PROTOCOL_VERSION ? undefined : { done: { ready } };
    }
    return message.type === "session" && ready ? { done: { ready, session: message } } : undefined;
  };
}

async function openSession(deps: HandshakeDeps, session: Session, hooks: ConnectionHooks): Promise<HelperConnection> {
  const channel = await deps.openSocket(`ws://127.0.0.1:${session.port}/`);
  const socket = new HelperConnection(channel, deps.logger, hooks);
  try {
    await socket.request({ type: "auth", token: session.token }, (m) => (m.type === "authed" ? { done: undefined } : undefined));
    return socket;
  } catch (error) {
    socket.disconnect();
    throw error;
  }
}

/** Only a ready helper keeps its connections. A missing host is a status, any other failure is logged and thrown. */
export async function runHandshake(deps: HandshakeDeps, hooks: ConnectionHooks & Required<Pick<ConnectionHooks, "onClose">>): Promise<Handshake> {
  let native: HelperConnection | undefined;
  try {
    native = new HelperConnection(createNativeTransport(deps.connectNative()), deps.logger, { onClose: hooks.onClose });
    const { ready, session } = await native.request({ type: "hello", extensionVersion: deps.extensionVersion, origin: deps.origin }, helloStep());
    const status = deriveHelperStatus(ready, PROTOCOL_VERSION);
    if (status.state !== "ready" || !session) {
      native.disconnect();
      return { status };
    }
    return { status, native, socket: await openSession(deps, session, hooks) };
  } catch (error) {
    native?.disconnect();
    if (error instanceof HelperVersionError) {
      await deps.logger.log("WARN", "browser.helper", "LabShelf Helper and this page speak different protocol versions", { helperProtocol: error.helperProtocol, pageProtocol: PROTOCOL_VERSION });
      return { status: deriveVersionErrorStatus(error, PROTOCOL_VERSION) };
    }
    if (!isHostNotFound(failureReason(error))) {
      await deps.logger.error("browser.helper", error, { step: "handshake", host: HELPER_HOST_NAME });
      throw error;
    }
    return { status: { state: "not-installed" } };
  }
}
