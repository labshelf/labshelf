// Validates each socket message and routes it, in arrival order, to the handler registered for its type.
// CONTRACT: documents/contracts/helper.md#envelope
import type { ILogger } from "../../../ports/index.js";
import { parseHelperMessage, PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";

import { HelperProjectError } from "../projects/index.js";
import type { HelperServerOptions } from "../connection/index.js";
import type { HelperHandlers, HelperSend } from "./helperHandlers.js";

const LOG_MODULE = "helper-dispatch";
// A message that never parsed has no id to answer; the envelope still needs one.
const NO_ID = "0";
// INVARIANT: cancellation and thumbnail replies must reach work that is waiting inside the ordered queue.
const UNQUEUED: ReadonlySet<ToHelperMessage["type"]> = new Set(["cancel", "templateThumbnail"]);

type ErrorReply = (id: string, code: string, message: string) => void;

const errorReply = (send: HelperSend): ErrorReply => (id, code, message) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });

async function runHandler(handlers: HelperHandlers, message: ToHelperMessage, send: HelperSend, logger: ILogger, payload: Uint8Array): Promise<void> {
  const reply = errorReply(send);
  const handler = handlers[message.type];
  if (!handler) {
    reply(message.id, "unknown-type", `${message.type} is not handled on the socket`);
    return;
  }
  try {
    await handler(message, send, payload);
  } catch (error) {
    if (error instanceof HelperProjectError) {
      void logger.log("WARN", LOG_MODULE, "Project request refused", { type: message.type, id: message.id, code: error.code, reason: error.message });
      reply(message.id, error.code, error.message);
      return;
    }
    await logger.error(LOG_MODULE, error, { type: message.type, id: message.id });
    reply(message.id, "internal", `${message.type} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseEnvelope(envelope: unknown, reply: ErrorReply, logger: ILogger): ToHelperMessage | undefined {
  const parsed = parseHelperMessage(envelope, "toHelper");
  if (parsed.ok) { return parsed.message; }
  void logger.log("WARN", LOG_MODULE, "Message rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
  reply(parsed.id ?? NO_ID, parsed.code, parsed.reason);
  return undefined;
}

export interface HelperAnswerer {
  /** Routes one socket message; the socket's `send` answers it. */
  handle: HelperServerOptions["handle"];
  /** Resolves when every accepted message has been handled. */
  drain(): Promise<void>;
}

export function createHelperAnswerer(handlers: HelperHandlers, logger: ILogger): HelperAnswerer {
  const backlog: Array<{ message: ToHelperMessage; send: HelperSend; payload: Uint8Array }> = [];
  const idleWaiters: Array<() => void> = [];
  let queueBusy = false;
  let inflight = 0;

  // INVARIANT: a queued handler starts synchronously when nothing is running, so a `cancel` that follows is never ahead of it.
  function pump(): void {
    if (queueBusy) { return; }
    const next = backlog.shift();
    if (!next) { return; }
    queueBusy = true;
    track(runHandler(handlers, next.message, next.send, logger, next.payload), () => { queueBusy = false; pump(); });
  }

  function track(task: Promise<void>, after?: () => void): void {
    inflight++;
    void task.finally(() => {
      inflight--;
      after?.();
      if (inflight === 0) { idleWaiters.splice(0).forEach((resolve) => resolve()); }
    });
  }

  const handle: HelperAnswerer["handle"] = (envelope, payload, socketSend) => {
    // TRAP: interfaces such as HelperProgress lack an index signature, so the message needs a cast to the socket envelope.
    const send: HelperSend = (message, payload) => socketSend(message as unknown as Record<string, unknown>, payload);
    const message = parseEnvelope(envelope, errorReply(send), logger);
    if (!message) { return; }
    if (UNQUEUED.has(message.type)) {
      track(runHandler(handlers, message, send, logger, payload));
      return;
    }
    backlog.push({ message, send, payload });
    pump();
  };

  const drain = () => (inflight === 0 ? Promise.resolve() : new Promise<void>((resolve) => { idleWaiters.push(resolve); }));
  return { handle, drain };
}
