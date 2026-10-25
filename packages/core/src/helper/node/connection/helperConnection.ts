// Runs one upgraded helper socket: token auth on the first message, then decoded messages to the handler, closing on any violation.
// CONTRACT: documents/contracts/helper.md#transport
import { createHash, timingSafeEqual } from "node:crypto";
import type { Duplex } from "node:stream";
import type { ILogger } from "../../../ports/index.js";
import { MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION } from "../../helperMessages.js";
import { parseHelperMessage } from "../../parseHelperMessage.js";
import { decodeConnectionMessage, encodeConnectionMessage } from "../../connectionFrame.js";
import { encodeServerFrame, FrameReader, OPCODE, type FrameEvent } from "./frameCodec.js";

const MODULE = "helperSocket";

export type ConnectionEnvelope = Record<string, unknown>;
export type ConnectionSend = (envelope: ConnectionEnvelope, payload?: Uint8Array) => void;
export type ConnectionHandler = (envelope: ConnectionEnvelope, payload: Uint8Array, send: ConnectionSend) => void | Promise<void>;

export interface ConnectionHooks {
  token: string;
  logger: ILogger;
  handle: ConnectionHandler;
  /** How long an upgraded socket may stay silent before it must have authenticated. */
  authTimeoutMs: number;
  /** Claims the single authenticated slot; false when another socket holds it. */
  claim(connection: HelperConnection): boolean;
  release(connection: HelperConnection): void;
}

function sameToken(given: unknown, expected: string): boolean {
  if (typeof given !== "string") { return false; }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export class HelperConnection {
  private readonly reader = new FrameReader(MAX_SOCKET_MESSAGE_BYTES);
  private authed = false;
  private closing = false;
  private readonly authTimer: NodeJS.Timeout;

  constructor(private readonly socket: Duplex, private readonly hooks: ConnectionHooks) {
    socket.on("data", (chunk: Buffer) => { for (const event of this.reader.push(chunk)) { this.onEvent(event); } });
    socket.on("error", (error) => { void hooks.logger.error(MODULE, error, { phase: "socket" }); });
    socket.on("close", () => { this.closing = true; clearTimeout(this.authTimer); hooks.release(this); });
    this.authTimer = setTimeout(() => this.close(1008, `no auth within ${hooks.authTimeoutMs} ms`), hooks.authTimeoutMs);
    this.authTimer.unref();
  }

  /** Sends a close frame with `code`, then ends the TCP connection. */
  close(code: number, reason: string): void {
    if (this.closing) { return; }
    this.closing = true;
    clearTimeout(this.authTimer);
    void this.hooks.logger.log("WARN", MODULE, `Closing helper socket: ${reason}`, { code });
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    this.socket.end(encodeServerFrame(OPCODE.close, body), () => this.socket.destroy());
  }

  destroy(): void {
    this.closing = true;
    clearTimeout(this.authTimer);
    this.socket.destroy();
  }

  private readonly send: ConnectionSend = (envelope, payload) => {
    if (this.closing) { return; }
    this.socket.write(encodeServerFrame(OPCODE.binary, encodeConnectionMessage(envelope, payload)));
  };

  private onEvent(event: FrameEvent): void {
    if (this.closing) { return; }
    switch (event.kind) {
      case "violation": this.close(event.status, event.reason); return;
      case "ping": this.socket.write(encodeServerFrame(OPCODE.pong, event.data)); return;
      case "pong": return;
      case "close": this.answerClose(event.data); return;
      case "message": this.onMessage(event.data); return;
    }
  }

  private answerClose(data: Buffer): void {
    this.closing = true;
    void this.hooks.logger.log("INFO", MODULE, "Helper socket closed by the page", { code: data.length >= 2 ? data.readUInt16BE(0) : undefined });
    this.socket.end(encodeServerFrame(OPCODE.close, data.subarray(0, 2)), () => this.socket.destroy());
  }

  private onMessage(data: Buffer): void {
    let message;
    try {
      message = decodeConnectionMessage(data);
    } catch (error) {
      this.close(1007, `undecodable socket message (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    if (!this.authed) { this.authenticate(message.envelope); return; }
    Promise.resolve()
      .then(() => this.hooks.handle(message.envelope, message.payload, this.send))
      .catch((error: unknown) => { void this.hooks.logger.error(MODULE, error, { type: message.envelope.type, id: message.envelope.id }); });
  }

  private authenticate(envelope: ConnectionEnvelope): void {
    const parsed = parseHelperMessage(envelope, "toHelper");
    if (!parsed.ok) { this.close(1008, `first message is not a valid auth (${parsed.reason})`); return; }
    const { message } = parsed;
    if (message.type !== "auth") { this.close(1008, `first message is ${message.type}, not auth`); return; }
    if (!sameToken(message.token, this.hooks.token)) { this.close(1008, "auth carries the wrong token"); return; }
    if (!this.hooks.claim(this)) { this.close(1008, "auth refused: another socket is already live, or the token is spent"); return; }
    this.authed = true;
    clearTimeout(this.authTimer);
    void this.hooks.logger.log("INFO", MODULE, "Helper socket authenticated");
    this.send({ v: PROTOCOL_VERSION, id: message.id, type: "authed" });
  }
}
