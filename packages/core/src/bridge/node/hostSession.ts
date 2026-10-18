/** Answers one browser connection's requests in arrival order, streaming reads and staging writes until commit. */
import type { ILogger } from "../../ports/index.js";
import { BridgeError } from "../bridgeError.js";
import { splitFileChunks } from "../fileChunks.js";
import type { BridgeRequest, BridgeResults, HostMessage } from "../protocol.js";
import { BRIDGE_PROTOCOL } from "../protocol.js";
import { assertSameProtocol, parseBridgeRequest, requestId } from "../requestValidation.js";
import { toBridgeError } from "./bridgeFailure.js";
import type { LibraryFileOperations } from "./fileOperations.js";
import { StagedWrites } from "./staging/index.js";

export interface BridgeHostSessionDeps {
  /** Undefined when the shared config names no library. */
  files: LibraryFileOperations | undefined;
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
  private greeted = false;
  /** Set when a hello of another protocol version arrives; later messages are dropped. */
  private refused = false;

  constructor(private readonly deps: BridgeHostSessionDeps) {}

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
      const id = requestId(message);
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
    const files = this.deps.files;
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
      case "ensureDir": await files.ensureDir(request.path); return {};
      case "rename": await files.rename(request.from, request.to); return {};
    }
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
