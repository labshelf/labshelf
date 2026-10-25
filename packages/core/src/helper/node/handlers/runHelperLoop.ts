// Reads native-messaging frames until EOF, passing the one `hello` on and refusing every other message.
// CONTRACT: documents/contracts/helper.md#transport
import type { ILogger } from "../../../ports/index.js";
import { parseHelperMessage, type HelperParseResult, type ToHelperMessage } from "../../index.js";

import { readFrames } from "../transport/index.js";
import type { HelloMessage } from "./answerHello.js";
import { createErrorReply, type ErrorReply, type HelperSend } from "./helperHandlers.js";
import { formatError } from "../../../logging/index.js";

const LOG_MODULE = "helper-loop";
// A frame that never parsed has no id to answer; the envelope still needs one.
const NO_ID = "0";

/** @returns whether the hello opened the session */
export type HelloAnswer = (message: HelloMessage, send: HelperSend) => Promise<boolean>;

function parseFrame(frame: Buffer, reply: ErrorReply, logger: ILogger): HelperParseResult<ToHelperMessage> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(frame.toString("utf8"));
  } catch (error) {
    void logger.log("WARN", LOG_MODULE, "Frame is not JSON", { bytes: frame.length, reason: formatError(error) });
    reply(NO_ID, "malformed", "frame is not valid JSON");
    return undefined;
  }
  return parseHelperMessage(raw, "toHelper");
}

async function answerFrame(frame: Buffer, greeted: boolean, hello: HelloAnswer, send: HelperSend, logger: ILogger, onVersionRejected: () => void): Promise<boolean> {
  const reply = createErrorReply(send);
  const parsed = parseFrame(frame, reply, logger);
  if (!parsed) { return false; }
  if (!parsed.ok) {
    void logger.log("WARN", LOG_MODULE, "Frame rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
    reply(parsed.id ?? NO_ID, parsed.code, parsed.reason);
    if (parsed.code === "version") { onVersionRejected(); }
    return false;
  }
  const { message } = parsed;
  if (message.type !== "hello" || greeted) {
    void logger.log("WARN", LOG_MODULE, "Native message refused", { type: message.type, id: message.id, greeted });
    reply(message.id, "unknown-type", greeted ? "the session is already open" : `${message.type} runs on the socket`);
    return false;
  }
  try {
    return await hello(message, send);
  } catch (error) {
    await logger.error(LOG_MODULE, error, { type: "hello", id: message.id });
    reply(message.id, "internal", `hello failed: ${formatError(error)}`);
    return false;
  }
}

/**
 * Resolves at EOF; rejects when the stream is corrupt (a frame past the size cap), after logging it.
 * `onVersionRejected` runs after a frame is refused for its protocol version, so the caller can look for an update.
 */
export async function runHelperLoop(
  input: AsyncIterable<Uint8Array>, hello: HelloAnswer, send: HelperSend, logger: ILogger, onVersionRejected: () => void = () => undefined,
): Promise<void> {
  let greeted = false;
  try {
    for await (const frame of readFrames(input, {
      onTruncated: (bytes) => void logger.log("WARN", LOG_MODULE, "Input ended inside a frame", { bytes }),
    })) {
      greeted = (await answerFrame(frame, greeted, hello, send, logger, onVersionRejected)) || greeted;
    }
  } catch (error) {
    await logger.error(LOG_MODULE, error);
    throw error;
  }
}
