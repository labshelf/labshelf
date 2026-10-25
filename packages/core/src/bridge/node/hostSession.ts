/** Answers one browser connection's requests in arrival order, streaming reads and staging writes until commit. */
import type { ILogger } from "../../ports/index.js";
import { BridgeError } from "../bridgeError.js";
import { splitFileChunks } from "../fileChunks.js";
import type { BridgeRequest, BridgeResults, HostMessage } from "../protocol.js";
import { BRIDGE_PROTOCOL } from "../protocol.js";
import { assertSameProtocol, parseBridgeRequest, parseRequestId } from "../requestValidation.js";
import type { LibraryFileOperations } from "./fileOperations.js";
import { base64ToBytes, joinBytes } from "../../encoding/index.js";
import { formatError } from "../../logging/index.js";

// CONTRACT: documents/contracts/bridge.md#file-transfer
const MAX_OPEN_WRITES = 8;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;

interface StagedWrite {
  path: string;
  parts: Uint8Array[];
  size: number;
}

interface CommittableWrite {
  path: string;
  bytes: Uint8Array;
}

const refuse = (message: string): never => { throw new BridgeError("protocol", message); };

class StagedWrites {
  private readonly writes = new Map<number, StagedWrite>();
  private stagedBytes = 0;

  open(id: number, path: string): void {
    if (this.writes.has(id)) refuse(`A writeFile with id ${id} is already open`);
    if (this.writes.size >= MAX_OPEN_WRITES) refuse(`At most ${MAX_OPEN_WRITES} writes may be open at once`);
    this.writes.set(id, { path, parts: [], size: 0 });
  }

  append(id: number, data: string): void {
    const write = this.get(id);
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(data);
    } catch {
      return refuse(`Chunk data for id ${id} is not canonical base64`);
    }
    if (this.stagedBytes + bytes.length > MAX_STAGED_BYTES) refuse(`Staged writes exceed ${MAX_STAGED_BYTES} bytes`);
    write.parts.push(bytes);
    write.size += bytes.length;
    this.stagedBytes += bytes.length;
  }

  /** Removes the write and returns its bytes when they add up to `size`; on a mismatch the write is dropped. */
  take(id: number, size: number): CommittableWrite {
    const write = this.get(id);
    this.drop(id);
    if (write.size !== size) refuse(`Commit for id ${id} declares ${size} bytes, ${write.size} were staged`);
    return { path: write.path, bytes: joinBytes(write.parts) };
  }

  drop(id: number): void {
    const write = this.writes.get(id);
    if (!write) return;
    this.stagedBytes -= write.size;
    this.writes.delete(id);
  }

  private get(id: number): StagedWrite {
    return this.writes.get(id) ?? refuse(`No open writeFile for id ${id}`);
  }
}

function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  const code = (error as NodeJS.ErrnoException).code;
  const message = formatError(error);
  return new BridgeError(code === "ENOENT" ? "notFound" : "io", message);
}

export interface BridgeHostSessionDeps {
  /** Undefined when the shared config names no library. */
  files: LibraryFileOperations | undefined;
  /** Checks the folder, records it in the shared config and starts serving it; refuses with `noLibrary`. */
  openLibrary(root: string): Promise<LibraryFileOperations>;
  send(message: HostMessage): Promise<void>;
  logger: ILogger;
  /** Stops reading the connection; called after refusing a hello of another protocol version. */
  close(): void;
}

type Result = BridgeResults[keyof BridgeResults];

const MODULE = "bridge";

export class BridgeHostSession {
  private queue: Promise<void> = Promise.resolve();
  /** Writes opened by `writeFile` and not yet committed, by request id. */
  private readonly staged = new StagedWrites();
  private files: LibraryFileOperations | undefined;
  private greeted = false;
  /** Set when a hello of another protocol version arrives; later messages are dropped. */
  private refused = false;

  constructor(private readonly deps: BridgeHostSessionDeps) {
    this.files = deps.files;
  }

  // INVARIANT: requests run one at a time, so a write's chunks and commit apply in the order they arrived.
  receive(message: unknown): Promise<void> {
    // A rejected send (EPIPE once the browser is gone) must not poison the queue or go unhandled.
    this.queue = this.queue.then(() => this.handle(message)).catch((error: unknown) => {
      void this.deps.logger.error(MODULE, error, { action: "send", request: describe(message) });
    });
    return this.queue;
  }

  private async handle(message: unknown): Promise<void> {
    if (this.refused) return;
    try {
      const request = parseBridgeRequest(message);
      const result = await this.dispatch(request);
      if (result !== undefined) await this.deps.send({ id: request.id, ok: true, result });
    } catch (error) {
      const failure = toBridgeError(error);
      const id = parseRequestId(message);
      if (id !== null) this.staged.drop(id);
      await this.deps.logger.log("WARN", MODULE, failure.message, { code: failure.code, request: describe(message) });
      try {
        await this.deps.send({ id, ok: false, error: failure.toBody() });
      } finally {
        if (this.refused) this.deps.close();
      }
    }
  }

  // CONTRACT: documents/contracts/bridge.md#versioning
  private greet(protocol: number): void {
    try {
      assertSameProtocol(protocol);
    } catch (error) {
      this.refused = true;
      throw error;
    }
    this.greeted = true;
  }

  /** @returns the result to answer with, or undefined for a message answered later (a staged chunk). */
  private async dispatch(request: BridgeRequest): Promise<Result | undefined> {
    if (request.op === "hello") this.greet(request.protocol);
    else if (!this.greeted) throw new BridgeError("protocol", `Send hello before ${request.op}`);
    if (request.op === "setLibrary") return this.setLibrary(request.root);
    const files = this.files;
    if (!files) throw new BridgeError("noLibrary", "No library folder is set up; open LabShelf in VS Code or the terminal first");
    switch (request.op) {
      case "hello": return { protocol: BRIDGE_PROTOCOL, libraryRoot: files.root, paperCount: await files.paperCount() };
      case "listDir": return files.listDir(request.path);
      case "stat": return files.stat(request.path);
      case "readFile": return this.streamFile(files, request.id, request.path);
      case "writeFile":
        await files.resolve(request.path);
        this.staged.open(request.id, request.path);
        return undefined;
      case "chunk": this.staged.append(request.id, request.data); return undefined;
      case "commit": return this.commit(files, request.id, request.size);
      case "deleteFile": await files.deleteFile(request.path); return {};
      case "deleteDir": await files.deleteDir(request.path); return {};
      case "ensureDir": await files.ensureDir(request.path); return {};
      case "rename": await files.rename(request.from, request.to); return {};
    }
  }

  // CONTRACT: documents/contracts/bridge.md#messages
  private async setLibrary(root: string): Promise<Result> {
    if (this.files) throw new BridgeError("protocol", "A library is already set");
    const files = await this.deps.openLibrary(root);
    this.files = files;
    await this.deps.logger.log("INFO", MODULE, "Library folder set by the browser", { libraryRoot: files.root });
    return { libraryRoot: files.root, paperCount: await files.paperCount() };
  }

  private async streamFile(files: LibraryFileOperations, id: number, relative: string): Promise<Result> {
    const bytes = await files.readFile(relative);
    for (const chunk of splitFileChunks(bytes)) await this.deps.send({ id, chunk });
    return { done: true, size: bytes.length };
  }

  private async commit(files: LibraryFileOperations, id: number, size: number): Promise<Result> {
    const { path, bytes } = this.staged.take(id, size);
    await files.writeFile(path, bytes);
    await this.deps.logger.log("INFO", MODULE, "Wrote file", { path, size: bytes.length });
    return { size: bytes.length };
  }
}

/** The request without its chunk data, for the log. */
function describe(message: unknown): unknown {
  if (typeof message !== "object" || message === null) return message;
  const { data: _data, ...rest } = message as Record<string, unknown>;
  return rest;
}
