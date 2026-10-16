// Registers the extension's library page as the handler of web+labshelf: links in browsers whose manifest cannot declare it.
import type { ILogger } from "@labshelf/core";

const LINK_SCHEME = "web+labshelf";

export interface ProtocolRegistration {
  /** True when the manifest declares the handler itself (Firefox `protocol_handlers`). */
  readonly declaredInManifest: boolean;
  readonly handlerUrl: string;
  readonly register: (scheme: string, url: string) => void;
  readonly log: ILogger;
}

/** Never throws: a browser that refuses the registration only loses the click-through. */
export function registerLinkHandler(reg: ProtocolRegistration): void {
  if (reg.declaredInManifest) return;
  try {
    reg.register(LINK_SCHEME, reg.handlerUrl);
  } catch (err) {
    void reg.log.log("WARN", "library-link", "Protocol handler registration failed", {
      scheme: LINK_SCHEME, url: reg.handlerUrl, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }
}
