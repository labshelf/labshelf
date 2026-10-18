// Answers `hello` with the helper's protocol version, its own version, the program that runs it and its TeX status.
import { PROTOCOL_VERSION, type HelperHost, type TexStatus } from "../../index.js";

import type { HelperHandler } from "./handlerTypes.js";

export interface HelloInfo { helperVersion: string; host: HelperHost; tex: TexStatus }

export function createHelloHandler(info: HelloInfo): HelperHandler {
  return async (message, send) => {
    send({ v: PROTOCOL_VERSION, id: message.id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: info.helperVersion, host: info.host, tex: info.tex });
  };
}
