// Pairs requests with the helper's replies by id and fails every pending request when the port closes.
import { parseHelperMessage, PROTOCOL_VERSION, type ToHelperMessage, type ToPageMessage } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import type { NativePort } from "./nativePort";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<ToHelperMessage, "v" | "id">;
/** Returns `{ done }` to settle the request with a value, or undefined to wait for more frames. */
type FrameStep<T> = (message: ToPageMessage) => { done: T } | undefined;

export class HelperClosedError extends Error {
  constructor(message: string, readonly reason: string | undefined) { super(message); }
}

interface Pending { type: string; step: FrameStep<unknown>; resolve: (value: unknown) => void; reject: (error: Error) => void }

const MODULE = "browser.helper.connection";

export class HelperConnection {
  private nextId = 1;
  private closed = false;
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly port: NativePort, private readonly logger: ILogger) {
    port.onMessage((frame) => this.receive(frame));
    port.onDisconnect((reason) => this.close(reason));
  }

  get isOpen(): boolean { return !this.closed; }

  /** Sends a frame no reply answers, such as `cancel`, and returns its id. */
  post(body: RequestBody): string {
    const id = String(this.nextId++);
    this.port.post({ v: PROTOCOL_VERSION, id, ...body });
    return id;
  }

  request<T>(body: RequestBody, step: FrameStep<T>): Promise<T> {
    if (this.closed) { return Promise.reject(new HelperClosedError(`LabShelf Helper is not connected (${body.type})`, undefined)); }
    return new Promise<T>((resolve, reject) => {
      const id = String(this.nextId);
      this.pending.set(id, { type: body.type, step, resolve: resolve as (value: unknown) => void, reject });
      this.post(body);
    });
  }

  disconnect(): void {
    this.port.disconnect();
    this.close("disconnected by the page");
  }

  private close(reason: string | undefined): void {
    if (this.closed) { return; }
    this.closed = true;
    for (const [id, pending] of this.pending) {
      pending.reject(new HelperClosedError(`LabShelf Helper closed the connection while request ${id} (${pending.type}) was pending: ${reason ?? "no reason given"}`, reason));
    }
    this.pending.clear();
  }

  private receive(frame: unknown): void {
    const parsed = parseHelperMessage(frame, "toPage");
    if (!parsed.ok) {
      void this.logger.log("WARN", MODULE, "Dropped an unreadable helper frame", { code: parsed.code, reason: parsed.reason });
      this.settleError(parsed.id, new Error(`LabShelf Helper sent an unreadable frame (${parsed.code}): ${parsed.reason}`));
      return;
    }
    const message = parsed.message;
    const pending = this.pending.get(message.id);
    if (!pending) { return; }
    if (message.type === "error") {
      this.settleError(message.id, new Error(`LabShelf Helper refused ${pending.type} (${message.code}): ${message.message}`));
      return;
    }
    try {
      const step = pending.step(message);
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
