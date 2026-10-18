// Answers `hello` with the helper's protocol version, its own version and its TeX status.
import { PROTOCOL_VERSION, type TexStatus } from "@labshelf/core/helper";

import type { HelperHandler } from "./handlerTypes.js";

export interface HelloInfo { helperVersion: string; tex: TexStatus }

export function createHelloHandler(info: HelloInfo): HelperHandler {
  return async (message, send) => {
    send({ v: PROTOCOL_VERSION, id: message.id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: info.helperVersion, tex: info.tex });
  };
}
