// Answers the native `hello`: opens the session's loopback socket, then replies `ready` and `session`.
// CONTRACT: documents/contracts/helper.md#transport
import { randomBytes } from "node:crypto";

import { PROTOCOL_VERSION, type HelperHost, type TexToolchain, type ToHelperMessage } from "../../index.js";
import type { HelperLogger } from "../log/index.js";
import { EXTENSION_ORIGIN, startHelperServer, type HelperServer, type HelperServerOptions } from "../connection/index.js";
import type { HelperSend } from "./helperHandlers.js";

const LOG_MODULE = "helper-session";

export type HelloMessage = Extract<ToHelperMessage, { type: "hello" }>;

export interface HelloOptions {
  helperVersion: string;
  host: HelperHost;
  /** Read on each hello, since an install changes it. */
  texStatus(): Promise<TexToolchain>;
  /** The caller origin Chrome passed on the command line, when it did. */
  callerOrigin?: string | undefined;
  logger: HelperLogger;
  handle: HelperServerOptions["handle"];
}

/** @returns the session's socket, or undefined when the hello was refused */
export async function answerHello(message: HelloMessage, send: HelperSend, options: HelloOptions): Promise<HelperServer | undefined> {
  const { id, origin } = message;
  const { logger } = options;
  if (!EXTENSION_ORIGIN.test(origin)) {
    await logger.log("WARN", LOG_MODULE, "Hello refused: origin is not an extension page", { origin });
    send({ v: PROTOCOL_VERSION, id, type: "error", code: "invalid-field", message: "origin must be a chrome-extension:// or moz-extension:// origin" });
    return undefined;
  }
  const token = randomBytes(32).toString("base64url");
  logger.redact(token);
  const socket = await startHelperServer({ token, origin, callerOrigin: options.callerOrigin, logger, handle: options.handle });
  send({ v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host, tex: await options.texStatus() });
  send({ v: PROTOCOL_VERSION, id, type: "session", port: socket.port, token });
  await logger.log("INFO", LOG_MODULE, "Session started", { port: socket.port, origin, extensionVersion: message.extensionVersion });
  return socket;
}
