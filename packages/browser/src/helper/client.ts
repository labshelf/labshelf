// Wires the LaTeX helper client of an extension page to the browser's native messaging and WebSocket.
import { createNativeLatexHelper, HELPER_HOST_NAME, type ILatexHelper } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import { bx, connectBrowserNative } from "../platform";
import { openHelperSocket } from "./connection";

export function createBrowserLatexHelper(logger: ILogger): ILatexHelper {
  return createNativeLatexHelper({
    logger,
    extensionVersion: bx.runtime.getManifest().version,
    origin: location.origin,
    connectNative: () => connectBrowserNative(HELPER_HOST_NAME),
    openSocket: (url) => openHelperSocket(url),
  });
}
