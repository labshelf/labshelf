// Keeps one greeted bridge connection, opening it on first use and again after the port dies.
import { assertSameProtocol, BRIDGE_PROTOCOL, type HelloResult, type ILogger } from "@labshelf/core";
import type { NativePort } from "../../platform";
import { BridgeConnection } from "./bridgeConnection";

export interface OpenBridge {
  connection: BridgeConnection;
  hello: HelloResult;
}

const MODULE = "browser.storage.bridge";

export class BridgeLink {
  private opening: Promise<OpenBridge> | undefined;
  private current: BridgeConnection | undefined;
  private readonly changeListeners = new Set<(paths: string[]) => void>();

  constructor(private readonly connect: () => NativePort, private readonly logger: ILogger) {}

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
