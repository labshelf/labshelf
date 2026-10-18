// Reads native-messaging frames until EOF, passing the one `hello` on and refusing every other message.
// CONTRACT: documents/contracts/helper.md#transport
import type { ILogger } from "../../../../ports/index.js";
import { parseHelperMessage, PROTOCOL_VERSION, type HelperParseResult, type ToHelperMessage } from "../../index.js";

import { readFrames } from "../stdio/index.js";
import type { HelloMessage } from "./answerHello.js";
import type { HelperSend } from "./handlerTypes.js";

const LOG_MODULE = "helper-loop";
// A frame that never parsed has no id to answer; the envelope still needs one.
const NO_ID = "0";

type ErrorReply = (id: string, code: string, message: string) => void;

/** @returns whether the hello opened the session */
export type HelloAnswer = (message: HelloMessage, send: HelperSend) => Promise<boolean>;

function parseFrame(frame: Buffer, reply: ErrorReply, logger: ILogger): HelperParseResult<ToHelperMessage> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(frame.toString("utf8"));
  } catch (error) {
    void logger.log("WARN", LOG_MODULE, "Frame is not JSON", { bytes: frame.length, reason: error instanceof Error ? error.message : String(error) });
    reply(NO_ID, "malformed", "frame is not valid JSON");
    return undefined;
  }
  return parseHelperMessage(raw, "toHelper");
}

async function answerFrame(frame: Buffer, greeted: boolean, hello: HelloAnswer, send: HelperSend, logger: ILogger): Promise<boolean> {
  const reply: ErrorReply = (id, code, message) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });
  const parsed = parseFrame(frame, reply, logger);
  if (!parsed) { return false; }
  if (!parsed.ok) {
    void logger.log("WARN", LOG_MODULE, "Frame rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
    reply(parsed.id ?? NO_ID, parsed.code, parsed.reason);
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
    reply(message.id, "internal", `hello failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Resolves at EOF; rejects when the stream is corrupt (a frame past the size cap), after logging it. */
export async function runHelperLoop(input: AsyncIterable<Uint8Array>, hello: HelloAnswer, send: HelperSend, logger: ILogger): Promise<void> {
  let greeted = false;
  try {
    for await (const frame of readFrames(input, {
      onTruncated: (bytes) => void logger.log("WARN", LOG_MODULE, "Input ended inside a frame", { bytes }),
    })) {
      greeted = (await answerFrame(frame, greeted, hello, send, logger)) || greeted;
    }
  } catch (error) {
    await logger.error(LOG_MODULE, error);
    throw error;
  }
}
