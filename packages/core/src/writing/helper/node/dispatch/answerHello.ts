// Answers the native `hello`: opens the session's loopback socket, then replies `ready` and `session`.
// CONTRACT: documents/contracts/helper.md#transport
import { randomBytes } from "node:crypto";

import type { ILogger } from "../../../../ports/index.js";
import { PROTOCOL_VERSION, type HelperHost, type TexStatus, type ToHelperMessage } from "../../index.js";
import { EXTENSION_ORIGIN, startHelperSocket, type HelperSocket, type HelperSocketOptions } from "../socket/index.js";
import type { HelperSend } from "./handlerTypes.js";

const LOG_MODULE = "helper-session";

export type HelloMessage = Extract<ToHelperMessage, { type: "hello" }>;

export interface HelloOptions {
  helperVersion: string;
  host: HelperHost;
  /** Read on each hello, since an install changes it. */
  texStatus(): Promise<TexStatus>;
  /** The caller origin Chrome passed on the command line, when it did. */
  callerOrigin?: string | undefined;
  logger: ILogger;
  handle: HelperSocketOptions["handle"];
}

/** @returns the session's socket, or undefined when the hello was refused */
export async function answerHello(message: HelloMessage, send: HelperSend, options: HelloOptions): Promise<HelperSocket | undefined> {
  const { id, origin } = message;
  const { logger } = options;
  if (!EXTENSION_ORIGIN.test(origin)) {
    await logger.log("WARN", LOG_MODULE, "Hello refused: origin is not an extension page", { origin });
    send({ v: PROTOCOL_VERSION, id, type: "error", code: "invalid-field", message: "origin must be a chrome-extension:// or moz-extension:// origin" });
    return undefined;
  }
  const token = randomBytes(32).toString("base64url");
  const socket = await startHelperSocket({ token, origin, callerOrigin: options.callerOrigin, logger, handle: options.handle });
  send({ v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host, tex: await options.texStatus() });
  send({ v: PROTOCOL_VERSION, id, type: "session", port: socket.port, token });
  await logger.log("INFO", LOG_MODULE, "Session started", { port: socket.port, origin, extensionVersion: message.extensionVersion });
  return socket;
}
