// Answers the page's messages: the native read loop that passes on the one `hello`, the hello answer that opens the session's
// socket, and the dispatcher that validates each socket message and routes it, in arrival order, to its handler.
// CONTRACT: documents/contracts/helper.md#transport
// CONTRACT: documents/contracts/helper.md#messages
import { randomBytes } from "node:crypto";

import type { ILogger } from "../../ports/index.js";
import { formatError } from "../../errors/index.js";
import type { PythonStatus } from "../../qmd/compute/node/index.js";
import { PROTOCOL_VERSION, type HelperHost, type HelperParseResult, type TexToolchain, type ToHelperMessage, type ToPageMessage } from "../helperMessages.js";
import { parseHelperMessage } from "../parseHelperMessage.js";
import { HelperProjectError } from "./helperProjects.js";
import type { HelperLogger } from "./helperPrivacy.js";
import { EXTENSION_ORIGIN, readFrames, startHelperServer, type HelperServer, type HelperServerOptions } from "./helperConnection.js";

/** Sends one message to the page; `payload` rides after the envelope on the socket (helper.md#transport). */
export type HelperSend = (message: ToPageMessage, payload?: Uint8Array) => void;
export type HelperHandler = (message: ToHelperMessage, send: HelperSend, payload?: Uint8Array) => Promise<void>;
export type HelperHandlers = Partial<Record<ToHelperMessage["type"], HelperHandler>>;

/** Answers message `id` with an error envelope. */
type ErrorReply = (id: string, code: string, message: string) => void;

const createErrorReply = (send: HelperSend): ErrorReply => (id, code, message) => send({ v: PROTOCOL_VERSION, id, type: "error", code, message });

const SESSION_LOG_MODULE = "helper-session";

export type HelloMessage = Extract<ToHelperMessage, { type: "hello" }>;

export interface HelloOptions {
  helperVersion: string;
  host: HelperHost;
  /** Read on each hello, since an install changes it. */
  texStatus(): Promise<TexToolchain>;
  /** Read on each hello when given; the `ready` then carries whether Python is installed. */
  pythonStatus?(): Promise<PythonStatus>;
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
    await logger.log("WARN", SESSION_LOG_MODULE, "Hello refused: origin is not an extension page", { origin });
    send({ v: PROTOCOL_VERSION, id, type: "error", code: "invalid-field", message: "origin must be a chrome-extension:// or moz-extension:// origin" });
    return undefined;
  }
  const token = randomBytes(32).toString("base64url");
  logger.redact(token);
  const socket = await startHelperServer({ token, origin, callerOrigin: options.callerOrigin, logger, handle: options.handle });
  const tex = await options.texStatus();
  const python = options.pythonStatus && (await options.pythonStatus()).state;
  send({
    v: PROTOCOL_VERSION, id, type: "ready", protocol: PROTOCOL_VERSION, helperVersion: options.helperVersion, host: options.host, tex,
    ...(python && { python }),
  });
  send({ v: PROTOCOL_VERSION, id, type: "session", port: socket.port, token });
  await logger.log("INFO", SESSION_LOG_MODULE, "Session started", { port: socket.port, origin, extensionVersion: message.extensionVersion });
  return socket;
}

const DISPATCH_LOG_MODULE = "helper-dispatch";
// A message or frame that never parsed has no id to answer; the envelope still needs one.
const NO_ID = "0";
// INVARIANT: cancellation, restarts and thumbnail replies must reach work that is waiting inside the ordered queue.
const UNQUEUED: ReadonlySet<ToHelperMessage["type"]> = new Set(["cancel", "cancelCell", "restartCell", "templateThumbnail"]);

async function runHandler(handlers: HelperHandlers, message: ToHelperMessage, send: HelperSend, logger: ILogger, payload: Uint8Array): Promise<void> {
  const reply = createErrorReply(send);
  const handler = handlers[message.type];
  if (!handler) {
    reply(message.id, "unknown-type", `${message.type} is not handled on the socket`);
    return;
  }
  try {
    await handler(message, send, payload);
  } catch (error) {
    if (error instanceof HelperProjectError) {
      void logger.log("WARN", DISPATCH_LOG_MODULE, "Project request refused", { type: message.type, id: message.id, code: error.code, reason: error.message });
      reply(message.id, error.code, error.message);
      return;
    }
    await logger.error(DISPATCH_LOG_MODULE, error, { type: message.type, id: message.id });
    reply(message.id, "internal", `${message.type} failed: ${formatError(error)}`);
  }
}

function parseEnvelope(envelope: unknown, reply: ErrorReply, logger: ILogger): ToHelperMessage | undefined {
  const parsed = parseHelperMessage(envelope, "toHelper");
  if (parsed.ok) { return parsed.message; }
  void logger.log("WARN", DISPATCH_LOG_MODULE, "Message rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
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
    const message = parseEnvelope(envelope, createErrorReply(send), logger);
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

const LOOP_LOG_MODULE = "helper-loop";

/** @returns whether the hello opened the session */
export type HelloAnswer = (message: HelloMessage, send: HelperSend) => Promise<boolean>;

function parseFrame(frame: Buffer, reply: ErrorReply, logger: ILogger): HelperParseResult<ToHelperMessage> | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(frame.toString("utf8"));
  } catch (error) {
    void logger.log("WARN", LOOP_LOG_MODULE, "Frame is not JSON", { bytes: frame.length, reason: formatError(error) });
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
    void logger.log("WARN", LOOP_LOG_MODULE, "Frame rejected", { code: parsed.code, reason: parsed.reason, id: parsed.id });
    reply(parsed.id ?? NO_ID, parsed.code, parsed.reason);
    if (parsed.code === "version") { onVersionRejected(); }
    return false;
  }
  const { message } = parsed;
  if (message.type !== "hello" || greeted) {
    void logger.log("WARN", LOOP_LOG_MODULE, "Native message refused", { type: message.type, id: message.id, greeted });
    reply(message.id, "unknown-type", greeted ? "the session is already open" : `${message.type} runs on the socket`);
    return false;
  }
  try {
    return await hello(message, send);
  } catch (error) {
    await logger.error(LOOP_LOG_MODULE, error, { type: "hello", id: message.id });
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
      onTruncated: (bytes) => void logger.log("WARN", LOOP_LOG_MODULE, "Input ended inside a frame", { bytes }),
    })) {
      greeted = (await answerFrame(frame, greeted, hello, send, logger, onVersionRejected)) || greeted;
    }
  } catch (error) {
    await logger.error(LOOP_LOG_MODULE, error);
    throw error;
  }
}
