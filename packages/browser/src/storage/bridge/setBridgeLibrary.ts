// Asks a host that serves no library to use a folder, over a short connection of its own.
import { BridgeError, BRIDGE_PROTOCOL, type BridgeResults, type ILogger } from "@labshelf/core";
import type { NativePort } from "../../platform";
import { BridgeConnection } from "./bridgeConnection";

const MODULE = "browser.storage.bridge";

/** @throws BridgeError with the host's code when the folder is refused or a library is already set */
export async function setBridgeLibrary(connect: () => NativePort, logger: ILogger, root: string): Promise<BridgeResults["setLibrary"]> {
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
