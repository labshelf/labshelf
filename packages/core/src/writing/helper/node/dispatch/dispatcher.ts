// Parses each incoming frame and routes it to the handler registered for its type.
// CONTRACT: documents/contracts/helper.md#envelope
import type { ILogger } from "../../../../ports/index.js";
import { parseHelperMessage, PROTOCOL_VERSION, type ToHelperMessage } from "../../index.js";

import type { HelperHandlers, HelperSend } from "./handlerTypes.js";

const LOG_MODULE = "helper-dispatch";
// A frame that never parsed has no id to answer; the envelope still needs one.
const NO_ID = "0";
// `cancel` must reach a running build, so it skips the queue that keeps every other message in arrival order.
const UNQUEUED: ReadonlySet<ToHelperMessage["type"]> = new Set(["cancel"]);

type ErrorReply = (id: string, code: string, message: string) => void;

const errorReply = (send: HelperSend): ErrorReply => (id, code, message) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });

async function runHandler(handlers: HelperHandlers, message: ToHelperMessage, send: HelperSend, logger: ILogger): Promise<void> {
  const reply = errorReply(send);
  const handler = handlers[message.type];
  if (!handler) {
    reply(message.id, "unknown-type", `${message.type} is not handled by this helper`);
    return;
  }
  try {
    await handler(message, send);
  } catch (error) {
    await logger.error(LOG_MODULE, error, { type: message.type, id: message.id });
    reply(message.id, "internal", `${message.type} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseFrame(frame: Buffer, reply: ErrorReply, logger: ILogger): ToHelperMessage | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(frame.toString("utf8"));
  } catch (error) {
    void logger.log("WARN", LOG_MODULE, "Frame is not JSON", { bytes: frame.length, reason: error instanceof Error ? error.message : String(error) });
    reply(NO_ID, "malformed", "frame is not valid JSON");
    return undefined;
  }
  const parsed = parseHelperMessage(raw, "toHelper");
  if (parsed.ok) { return parsed.message; }
  void logger.log("WARN", LOG_MODULE, "Frame rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
  reply(parsed.id ?? NO_ID, parsed.code, parsed.reason);
  return undefined;
}

export interface Dispatcher {
  accept(frame: Buffer): void;
  /** Resolves when every accepted frame has been handled. */
  drain(): Promise<void>;
}

export function createDispatcher(handlers: HelperHandlers, send: HelperSend, logger: ILogger): Dispatcher {
  const backlog: ToHelperMessage[] = [];
  const idleWaiters: Array<() => void> = [];
  let queueBusy = false;
  let inflight = 0;

  const reply = errorReply(send);
  const run = (message: ToHelperMessage) => runHandler(handlers, message, send, logger);

  // INVARIANT: a queued handler starts synchronously when nothing is running, so a `cancel` that follows is never ahead of it.
  function pump(): void {
    if (queueBusy) { return; }
    const next = backlog.shift();
    if (!next) { return; }
    queueBusy = true;
    track(run(next), () => { queueBusy = false; pump(); });
  }

  function track(task: Promise<void>, after?: () => void): void {
    inflight++;
    void task.finally(() => {
      inflight--;
      after?.();
      if (inflight === 0) { idleWaiters.splice(0).forEach((resolve) => resolve()); }
    });
  }

  function accept(frame: Buffer): void {
    const message = parseFrame(frame, reply, logger);
    if (!message) { return; }
    if (UNQUEUED.has(message.type)) {
      track(run(message));
      return;
    }
    backlog.push(message);
    pump();
  }

  const drain = () => (inflight === 0 ? Promise.resolve() : new Promise<void>((resolve) => { idleWaiters.push(resolve); }));
  return { accept, drain };
}
