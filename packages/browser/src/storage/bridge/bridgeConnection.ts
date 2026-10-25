// Pairs bridge requests with the host's answers over one native port and fails every pending request when it closes.
import {
  base64ToBytes, BridgeError, joinBytes, splitFileChunks,
  type BridgeErrorCode, type BridgeRequest, type BridgeResults, type ILogger,
} from "@labshelf/core";
import type { NativePort } from "../../platform";

type Result = Record<string, unknown>;

const STAT_FIELDS = { isFile: "boolean", isDirectory: "boolean", mtimeMs: "number", size: "number" } as const;

const isStat = (value: unknown): boolean => value === null
  || (typeof value === "object" && Object.entries(STAT_FIELDS).every(([key, type]) => typeof (value as Result)[key] === type));

// CONTRACT: documents/contracts/bridge.md#messages
const SHAPES: Partial<Record<string, (result: Result) => boolean>> = {
  hello: (r) => typeof r.protocol === "number" && typeof r.libraryRoot === "string" && typeof r.paperCount === "number",
  setLibrary: (r) => typeof r.libraryRoot === "string" && typeof r.paperCount === "number",
  listDir: (r) => Array.isArray(r.names) && r.names.every((name) => typeof name === "string"),
  stat: (r) => isStat(r.stat),
  readFile: (r) => r.done === true && typeof r.size === "number",
};

/** Returns the result when it fits `op`; an op without a listed shape needs only an object. */
function checkReply(op: string, result: unknown): Result {
  const fits = typeof result === "object" && result !== null && (SHAPES[op]?.(result as Result) ?? true);
  if (!fits) throw new BridgeError("protocol", `The bridge answered ${op} with a malformed result: ${JSON.stringify(result)?.slice(0, 200)}`);
  return result as Result;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A request answered by one response; reads and writes go through `readFile` and `writeFile`. */
export type BridgeCall = Exclude<DistributiveOmit<BridgeRequest, "id">, { op: "readFile" | "writeFile" | "chunk" | "commit" }>;
type CallResult<R extends BridgeCall> = BridgeResults[R["op"] & keyof BridgeResults];

export class BridgeClosedError extends Error {
  constructor(readonly reason: string | undefined) {
    super(`The LabShelf bridge closed${reason ? `: ${reason}` : ""}`);
    this.name = "BridgeClosedError";
  }
}

interface Pending { op: string; resolve: (result: unknown) => void; reject: (error: Error) => void; chunks: Uint8Array[] }

const MODULE = "browser.storage.bridge";
const ERROR_CODES = new Set<string>(["notFound", "outsideLibrary", "noLibrary", "protocol", "io"]);

export class BridgeConnection {
  private nextId = 1;
  private closedBy: BridgeClosedError | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly closeListeners: Array<() => void> = [];

  constructor(private readonly port: NativePort, private readonly logger: ILogger, private readonly onChanged: (paths: string[]) => void) {
    port.onMessage((frame) => this.receive(frame));
    port.onDisconnect((reason) => this.closed(reason));
  }

  get isOpen(): boolean { return this.closedBy === undefined; }

  onClosed(listener: () => void): void { this.closeListeners.push(listener); }

  request<R extends BridgeCall>(body: R): Promise<CallResult<R>> {
    return this.send([body]) as Promise<CallResult<R>>;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const pending = this.send([{ op: "readFile", path }]);
    const { size, chunks } = (await pending) as { size: number; chunks: Uint8Array[] };
    const bytes = joinBytes(chunks);
    if (bytes.length !== size) throw new BridgeError("protocol", `${path}: the host announced ${size} bytes and sent ${bytes.length}`);
    return bytes;
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const chunks = splitFileChunks(bytes).map((data) => ({ op: "chunk" as const, data }));
    await this.send([{ op: "writeFile", path }, ...chunks, { op: "commit", size: bytes.length }]);
  }

  /** Closes the port on purpose; pending requests fail like on any other close. */
  close(): void {
    this.port.disconnect();
    this.closed("closed by the extension");
  }

  // INVARIANT: every message of one request carries the same id, and only the last one is answered.
  private send(messages: [{ op: string; [field: string]: unknown }, ...Array<Record<string, unknown>>]): Promise<unknown> {
    if (this.closedBy) return Promise.reject(this.closedBy);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { op: messages[0].op, resolve, reject, chunks: [] });
      try {
        for (const message of messages) this.port.post({ id, ...message });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private receive(frame: unknown): void {
    if (typeof frame !== "object" || frame === null) return this.ignore(frame);
    const message = frame as Record<string, unknown>;
    if (message.event === "changed" && Array.isArray(message.paths)) {
      return this.onChanged(message.paths.filter((path): path is string => typeof path === "string"));
    }
    if (message.id === null && message.ok === false) return this.hostRefused(message.error);
    const pending = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (!pending) return this.ignore(frame);
    if (typeof message.chunk === "string") return this.addChunk(message.id as number, pending, message.chunk);
    this.pending.delete(message.id as number);
    if (message.ok === true) this.settle(pending, message.result);
    else pending.reject(toBridgeError(message.error));
  }

  // A malformed reply fails only its own request; the connection stays open for the next one.
  private settle(pending: Pending, result: unknown): void {
    try {
      const checked = checkReply(pending.op, result);
      pending.resolve(pending.op === "readFile" ? { size: checked.size, chunks: pending.chunks } : checked);
    } catch (error) {
      pending.reject(error as Error);
    }
  }

  private addChunk(id: number, pending: Pending, chunk: string): void {
    try {
      pending.chunks.push(base64ToBytes(chunk));
    } catch (error) {
      this.pending.delete(id);
      pending.reject(new BridgeError("protocol", `The bridge sent a chunk that is not base64: ${String(error)}`));
    }
  }

  // The host stops reading after an id-less refusal, so nothing pending will be answered.
  private hostRefused(body: unknown): void {
    const error = toBridgeError(body);
    void this.logger.error(MODULE, error, { pending: this.pending.size });
    this.failPending(error);
  }

  private ignore(frame: unknown): void {
    void this.logger.log("WARN", MODULE, "Ignored an unexpected bridge message", { frame: JSON.stringify(frame)?.slice(0, 200) });
  }

  private closed(reason: string | undefined): void {
    if (this.closedBy) return;
    this.closedBy = new BridgeClosedError(reason);
    void this.logger.log("INFO", MODULE, "Bridge port closed", { reason, pending: this.pending.size });
    this.failPending(this.closedBy);
    for (const listener of this.closeListeners) listener();
  }

  private failPending(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(error);
  }
}

function toBridgeError(body: unknown): BridgeError {
  const { code, message } = (body ?? {}) as { code?: unknown; message?: unknown };
  const known = typeof code === "string" && ERROR_CODES.has(code) ? (code as BridgeErrorCode) : "protocol";
  return new BridgeError(known, typeof message === "string" ? message : `The bridge answered an error without a message (${String(code)})`);
}
