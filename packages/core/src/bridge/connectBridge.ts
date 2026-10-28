// Keeps one bridge connection open across reconnects, explains why the bridge is unusable and chooses the library folder.
import { formatError } from "../errors/index.js";
import type { ILogger, NativeMessagePort } from "../ports/index.js";
import { BridgeClosedError, BridgeConnection, BRIDGE_LOG_MODULE as MODULE } from "./bridgeConnection.js";
import { BridgeError } from "./bridgeError.js";
import { isHostNotFound } from "./hostNotFound.js";
import { assertSameProtocol, BRIDGE_PROTOCOL, type BridgeResults, type HelloResult } from "./protocol.js";

export interface OpenBridge {
  connection: BridgeConnection;
  hello: HelloResult;
}

export class BridgeClient {
  private opening: Promise<OpenBridge> | undefined;
  private current: BridgeConnection | undefined;
  private readonly changeListeners = new Set<(paths: string[]) => void>();

  constructor(private readonly connect: () => NativeMessagePort, private readonly logger: ILogger) {}

  open(): Promise<OpenBridge> {
    this.opening ??= this.start().catch((error: unknown) => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }

  /** Subscribes to the host's `changed` batches across reconnects. */
  onChanged(listener: (paths: string[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private async start(): Promise<OpenBridge> {
    void this.logger.log("INFO", MODULE, "Connecting to the LabShelf bridge");
    const connection = new BridgeConnection(this.connect(), this.logger, (paths) => {
      for (const listener of this.changeListeners) listener(paths);
    });
    this.current = connection;
    // PLATFORM: an MV3 service worker that sleeps kills its native port, so the next use reconnects and greets again.
    connection.onClosed(() => {
      if (this.current !== connection) return;
      this.current = undefined;
      this.opening = undefined;
    });
    try {
      const hello = await connection.request({ op: "hello", protocol: BRIDGE_PROTOCOL });
      assertSameProtocol(hello.protocol);
      void this.logger.log("INFO", MODULE, "Bridge connected", { libraryRoot: hello.libraryRoot, paperCount: hello.paperCount });
      return { connection, hello };
    } catch (error) {
      if (connection.isOpen) connection.close();
      throw error;
    }
  }
}

export type BridgeFailureKind = "not-installed" | "protocol-mismatch" | "no-library" | "failed";

export interface BridgeFailure {
  reason: BridgeFailureKind;
  detail?: string;
}

export function deriveBridgeFailure(error: unknown): BridgeFailure {
  if (error instanceof BridgeClosedError && isHostNotFound(error.reason)) return { reason: "not-installed" };
  if (error instanceof BridgeError && error.code === "protocol") return { reason: "protocol-mismatch", detail: error.message };
  if (error instanceof BridgeError && error.code === "noLibrary") return { reason: "no-library", detail: error.message };
  return { reason: "failed", detail: formatError(error) };
}

/** @throws BridgeError with the host's code when the folder is refused or a library is already set */
export async function setBridgeLibrary(connect: () => NativeMessagePort, logger: ILogger, root: string): Promise<BridgeResults["setLibrary"]> {
  const connection = new BridgeConnection(connect(), logger, () => undefined);
  try {
    // A host without a library answers hello with noLibrary but still counts the connection as greeted.
    await connection.request({ op: "hello", protocol: BRIDGE_PROTOCOL }).catch((error: unknown) => {
      if (!(error instanceof BridgeError && error.code === "noLibrary")) throw error;
    });
    const result = await connection.request({ op: "setLibrary", root });
    void logger.log("INFO", MODULE, "Library folder chosen", { libraryRoot: result.libraryRoot, paperCount: result.paperCount });
    return result;
  } finally {
    if (connection.isOpen) connection.close();
  }
}
