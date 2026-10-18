// Builds the LaTeX helper client for an extension page, wired to the browser's native messaging.
import { HELPER_HOST_NAME, type ILatexHelper } from "@labshelf/core/helper";
import type { ILogger } from "@labshelf/core";
import { bx, connectBrowserNative } from "../../platform";
import { createNativeLatexHelper } from "./createNativeLatexHelper";

export function createBrowserLatexHelper(logger: ILogger): ILatexHelper {
  return createNativeLatexHelper({
    logger,
    extensionVersion: bx.runtime.getManifest().version,
    origin: location.origin,
    connectNative: () => connectBrowserNative(HELPER_HOST_NAME),
  });
}
