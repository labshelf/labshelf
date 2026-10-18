// Pairs requests with the helper's replies by id over a channel and fails every pending request when the channel closes.
import { parseHelperMessage, PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import type { HelperChannel } from "./helperChannel";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<ToHelperMessage, "v" | "id">;
/** Returns `{ done }` to settle the request with a value, or undefined to wait for more messages. */
export type FrameStep<T> = (message: ToPageMessage, payload: Uint8Array) => { done: T } | undefined;
type ErrorMessage = Extract<ToPageMessage, { type: "error" }>;

export class HelperClosedError extends Error {
  constructor(message: string, readonly reason: string | undefined) { super(message); }
}

export interface ConnectionHooks {
  /** Messages the helper sends unasked. */
  onLsp?: (message: Extract<ToPageMessage, { type: "lsp" }>) => void;
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

  constructor(private readonly channel: HelperChannel, private readonly logger: ILogger, private readonly hooks: ConnectionHooks = {}) {
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
      this.settleError(parsed.id, new Error(`LabShelf Helper sent an unreadable message (${parsed.code}): ${parsed.reason}`));
      return;
    }
    const message = parsed.message;
    if (message.type === "lsp") { this.hooks.onLsp?.(message); return; }
    const pending = message.id === undefined ? undefined : this.pending.get(message.id);
    if (!pending || message.id === undefined) {
      if (message.type === "error") { this.hooks.onUnmatchedError?.(message); }
      return;
    }
    if (message.type === "error") {
      this.settleError(message.id, new Error(`LabShelf Helper refused ${pending.type} (${message.code}): ${message.message}`));
      return;
    }
    try {
      const step = pending.step(message, payload);
      if (step) { this.pending.delete(message.id); pending.resolve(step.done); }
    } catch (error) {
      this.settleError(message.id, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private settleError(id: string | undefined, error: Error): void {
    const pending = id === undefined ? undefined : this.pending.get(id);
    if (!pending || id === undefined) { return; }
    this.pending.delete(id);
    pending.reject(error);
  }
}
