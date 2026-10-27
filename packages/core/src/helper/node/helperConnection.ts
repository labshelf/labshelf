// Runs the helper's two transports: the native-messaging frames on stdio, and the loopback WebSocket server whose single socket
// authenticates with the session token, then carries decoded messages to the handler.
// CONTRACT: documents/contracts/helper.md#transport
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import type { Duplex } from "node:stream";

import type { ILogger } from "../../ports/index.js";
import { formatError } from "../../errors/index.js";
import { MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type ToPageMessage } from "../helperMessages.js";
import { parseHelperMessage } from "../parseHelperMessage.js";
import { decodeConnectionMessage, encodeConnectionMessage } from "../helperPaths.js";

const HEADER_BYTES = 4;
// The page sends only `hello` on native messaging, far under this; a bigger length means a corrupt stream.
const MAX_INCOMING_FRAME_BYTES = 4 * 1024 * 1024;

export interface ReadFramesOptions {
  maxFrameBytes?: number;
  /** Called at EOF with the number of bytes of a frame that never completed. */
  onTruncated?: (bytes: number) => void;
}

const readLength = (buffer: Buffer): number => (os.endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0));

/** Yields each frame's JSON payload. Throws when a frame announces more than `maxFrameBytes`, because the stream cannot be resynchronised after that. */
export async function* readFrames(input: AsyncIterable<Uint8Array>, options: ReadFramesOptions = {}): AsyncGenerator<Buffer> {
  const maxFrameBytes = options.maxFrameBytes ?? MAX_INCOMING_FRAME_BYTES;
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (pending.length >= HEADER_BYTES) {
      const length = readLength(pending);
      if (length > maxFrameBytes) { throw new Error(`Incoming frame of ${length} bytes exceeds the ${maxFrameBytes}-byte limit`); }
      if (pending.length < HEADER_BYTES + length) { break; }
      yield pending.subarray(HEADER_BYTES, HEADER_BYTES + length);
      pending = pending.subarray(HEADER_BYTES + length);
    }
  }
  if (pending.length > 0) { options.onTruncated?.(pending.length); }
}

/** The browser closes the host when a frame from it exceeds 1 MB. */
export const MAX_OUTGOING_FRAME_BYTES = 1024 * 1024;
const STDIO_LOG_MODULE = "helper-stdio";

export interface FrameOutput { write(chunk: Buffer): unknown }

function encodeStdioFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  if (os.endianness() === "LE") { header.writeUInt32LE(payload.length); } else { header.writeUInt32BE(payload.length); }
  return Buffer.concat([header, payload]);
}

/**
 * Returns the function handlers use to answer the page. An oversize message is logged and replaced by a `limit` error
 * with the same id, so the page does not wait for a reply that cannot arrive.
 */
export function createFrameWriter(output: FrameOutput, logger: ILogger): (message: ToPageMessage) => void {
  return (message) => {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    if (payload.length <= MAX_OUTGOING_FRAME_BYTES) {
      output.write(encodeStdioFrame(payload));
      return;
    }
    void logger.log("ERROR", STDIO_LOG_MODULE, "Refused an outgoing frame over the 1 MB limit", { type: message.type, id: message.id, bytes: payload.length });
    const refusal: ToPageMessage = { v: message.v, id: message.id, type: "error", code: "limit", message: `Reply of ${payload.length} bytes exceeds the 1 MB frame limit` };
    output.write(encodeStdioFrame(Buffer.from(JSON.stringify(refusal), "utf8")));
  };
}

const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension):\/\/[^/]+$/;

interface UpgradeRules { origin: string; callerOrigin?: string | undefined }

type UpgradeResult = { accepted: true; response: string } | { accepted: false; reason: string; response: string };

// PLATFORM: Chrome passes the caller origin as `chrome-extension://<id>/`, with a trailing slash the Origin header lacks.
const normaliseOrigin = (origin: string): string => origin.replace(/\/+$/, "");

function refuse(reason: string, status = "403 Forbidden"): UpgradeResult {
  return { accepted: false, reason, response: `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n` };
}

function originRefusal(header: string | undefined, rules: UpgradeRules): string | undefined {
  if (header === undefined) { return "upgrade has no Origin header"; }
  const origin = normaliseOrigin(header);
  if (origin !== normaliseOrigin(rules.origin)) { return `Origin ${header} differs from the hello origin ${rules.origin}`; }
  if (!EXTENSION_ORIGIN.test(origin)) { return `Origin ${header} is not an extension origin`; }
  if (rules.callerOrigin !== undefined && origin !== normaliseOrigin(rules.callerOrigin)) {
    return `Origin ${header} differs from the caller origin ${rules.callerOrigin}`;
  }
  return undefined;
}

// PLATFORM: Chrome always offers permessage-deflate; the answer omits Sec-WebSocket-Extensions, which declines every extension (RFC 6455 section 9.1).
function checkUpgrade(request: IncomingMessage, rules: UpgradeRules): UpgradeResult {
  const { headers } = request;
  if (headers.upgrade?.toLowerCase() !== "websocket") { return refuse("request is not a WebSocket upgrade", "426 Upgrade Required"); }
  const originProblem = originRefusal(headers.origin, rules);
  if (originProblem) { return refuse(originProblem); }
  if (headers["sec-websocket-protocol"] !== undefined) { return refuse(`upgrade asks for subprotocol ${headers["sec-websocket-protocol"]}`, "400 Bad Request"); }
  if (headers["sec-websocket-version"] !== "13") { return refuse(`upgrade asks for WebSocket version ${headers["sec-websocket-version"]}`, "426 Upgrade Required"); }
  const key = headers["sec-websocket-key"];
  if (typeof key !== "string" || Buffer.from(key, "base64").length !== 16) { return refuse("upgrade has no valid Sec-WebSocket-Key", "400 Bad Request"); }
  const accept = createHash("sha1").update(key + ACCEPT_GUID).digest("base64");
  return {
    accepted: true,
    response: `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  };
}

const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

type FrameEvent =
  | { kind: "message"; data: Buffer }
  | { kind: "close"; data: Buffer }
  | { kind: "ping"; data: Buffer }
  | { kind: "pong" }
  | { kind: "violation"; reason: string; status: number };

interface FrameHeader { fin: boolean; reserved: number; opcode: number; length: number; headerBytes: number; mask: Buffer }

function encodeServerFrame(opcode: number, data: Uint8Array = new Uint8Array(0)): Buffer {
  const length = data.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header.writeUInt16BE(length, 2);
    header[1] = 126;
  } else {
    header = Buffer.alloc(10);
    header.writeBigUInt64BE(BigInt(length), 2);
    header[1] = 127;
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function readHeader(buffer: Buffer): FrameHeader | undefined {
  if (buffer.length < 2) { return undefined; }
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) { return undefined; }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) { return undefined; }
    const declared = buffer.readBigUInt64BE(2);
    length = declared > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(declared);
    offset = 10;
  }
  const masked = (buffer[1]! & 0x80) !== 0;
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes) { return undefined; }
  return {
    fin: (buffer[0]! & 0x80) !== 0, reserved: buffer[0]! & 0x70, opcode: buffer[0]! & 0x0f, length,
    headerBytes: offset + maskBytes, mask: masked ? buffer.subarray(offset, offset + 4) : Buffer.alloc(0),
  };
}

function unmask(data: Buffer, mask: Buffer): Buffer {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 1) { out[i] = out[i]! ^ mask[i % 4]!; }
  return out;
}

/** Collects TCP chunks and yields one event per complete frame or reassembled message. */
class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmenting = false;

  constructor(private readonly maxMessageBytes: number) {}

  push(chunk: Buffer): FrameEvent[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const events: FrameEvent[] = [];
    for (;;) {
      const header = readHeader(this.buffer);
      if (!header) { return events; }
      const violation = this.check(header);
      if (violation) { events.push(violation); return events; }
      const end = header.headerBytes + header.length;
      if (this.buffer.length < end) { return events; }
      const data = unmask(this.buffer.subarray(header.headerBytes, end), header.mask);
      this.buffer = this.buffer.subarray(end);
      const event = this.accept(header, data);
      if (event) { events.push(event); }
    }
  }

  // INVARIANT: runs on the header alone, so an oversized frame is refused before its body is buffered.
  private check(header: FrameHeader): FrameEvent | undefined {
    const violation = (reason: string, status = 1002): FrameEvent => ({ kind: "violation", reason, status });
    if (header.reserved !== 0) { return violation("frame sets reserved bits, but no extension is negotiated"); }
    if (header.mask.length === 0) { return violation("client frame is not masked"); }
    if (header.opcode === OPCODE.text) { return violation("text frames are refused", 1003); }
    if (header.opcode >= 0x8) {
      if (!header.fin || header.length > 125) { return violation("control frame is fragmented or over 125 bytes"); }
      if (header.opcode > OPCODE.pong) { return violation(`unknown opcode ${header.opcode}`); }
      return undefined;
    }
    if (header.opcode !== OPCODE.binary && header.opcode !== OPCODE.continuation) { return violation(`unknown opcode ${header.opcode}`); }
    if ((header.opcode === OPCODE.continuation) !== this.fragmenting) { return violation("continuation frame out of sequence"); }
    if (this.fragmentBytes + header.length > this.maxMessageBytes) {
      return violation(`message over the 16 MiB limit (${this.fragmentBytes + header.length} bytes declared)`, 1009);
    }
    return undefined;
  }

  private accept(header: FrameHeader, data: Buffer): FrameEvent | undefined {
    if (header.opcode === OPCODE.close) { return { kind: "close", data }; }
    if (header.opcode === OPCODE.ping) { return { kind: "ping", data }; }
    if (header.opcode === OPCODE.pong) { return { kind: "pong" }; }
    this.fragments.push(data);
    this.fragmentBytes += data.length;
    this.fragmenting = !header.fin;
    if (!header.fin) { return undefined; }
    const message = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentBytes = 0;
    return { kind: "message", data: message };
  }
}

const SOCKET_LOG_MODULE = "helperSocket";

export type ConnectionEnvelope = Record<string, unknown>;
export type ConnectionSend = (envelope: ConnectionEnvelope, payload?: Uint8Array) => void;
export type ConnectionHandler = (envelope: ConnectionEnvelope, payload: Uint8Array, send: ConnectionSend) => void | Promise<void>;

interface ConnectionHooks {
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

class HelperConnection {
  private readonly reader = new FrameReader(MAX_SOCKET_MESSAGE_BYTES);
  private authed = false;
  private closing = false;
  private readonly authTimer: NodeJS.Timeout;

  constructor(private readonly socket: Duplex, private readonly hooks: ConnectionHooks) {
    socket.on("data", (chunk: Buffer) => { for (const event of this.reader.push(chunk)) { this.onEvent(event); } });
    socket.on("error", (error) => { void hooks.logger.error(SOCKET_LOG_MODULE, error, { phase: "socket" }); });
    socket.on("close", () => { this.closing = true; clearTimeout(this.authTimer); hooks.release(this); });
    this.authTimer = setTimeout(() => this.close(1008, `no auth within ${hooks.authTimeoutMs} ms`), hooks.authTimeoutMs);
    this.authTimer.unref();
  }

  /** Sends a close frame with `code`, then ends the TCP connection. */
  close(code: number, reason: string): void {
    if (this.closing) { return; }
    this.closing = true;
    clearTimeout(this.authTimer);
    void this.hooks.logger.log("WARN", SOCKET_LOG_MODULE, `Closing helper socket: ${reason}`, { code });
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code, 0);
    this.socket.end(encodeServerFrame(OPCODE.close, body), () => this.socket.destroy());
  }

  destroy(): void { this.closing = true; clearTimeout(this.authTimer); this.socket.destroy(); }

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
    void this.hooks.logger.log("INFO", SOCKET_LOG_MODULE, "Helper socket closed by the page", { code: data.length >= 2 ? data.readUInt16BE(0) : undefined });
    this.socket.end(encodeServerFrame(OPCODE.close, data.subarray(0, 2)), () => this.socket.destroy());
  }

  private onMessage(data: Buffer): void {
    let message;
    try {
      message = decodeConnectionMessage(data);
    } catch (error) {
      this.close(1007, `undecodable socket message (${formatError(error)})`);
      return;
    }
    if (!this.authed) { this.authenticate(message.envelope); return; }
    Promise.resolve()
      .then(() => this.hooks.handle(message.envelope, message.payload, this.send))
      .catch((error: unknown) => { void this.hooks.logger.error(SOCKET_LOG_MODULE, error, { type: message.envelope.type, id: message.envelope.id }); });
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
    void this.hooks.logger.log("INFO", SOCKET_LOG_MODULE, "Helper socket authenticated");
    this.send({ v: PROTOCOL_VERSION, id: message.id, type: "authed" });
  }
}

const AUTH_TIMEOUT_MS = 10_000;

export interface HelperServerOptions {
  token: string;
  /** The origin the page sent in `hello`. */
  origin: string;
  /** The caller origin Chrome passed as the helper's first argument, when it did. */
  callerOrigin?: string | undefined;
  logger: ILogger;
  handle: ConnectionHandler;
  /** Closes a socket that has not authenticated within this time; 10 s when absent. */
  authTimeoutMs?: number;
}

export interface HelperServer { port: number; close(): Promise<void> }

export async function startHelperServer(options: HelperServerOptions): Promise<HelperServer> {
  const { logger } = options;
  const connections = new Set<HelperConnection>();
  let live: HelperConnection | undefined;
  // INVARIANT: the token authenticates one socket; the page reconnects through a new native hello, which mints a new token.
  let spent = false;
  const hooks = {
    token: options.token, logger, handle: options.handle, authTimeoutMs: options.authTimeoutMs ?? AUTH_TIMEOUT_MS,
    claim: (connection: HelperConnection) => (live === undefined && !spent ? ((live = connection), true) : false),
    release: (connection: HelperConnection) => {
      connections.delete(connection);
      if (live === connection) { live = undefined; spent = true; }
    },
  };

  const server = createServer((_request, response) => { response.writeHead(426, { Connection: "close" }).end(); });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const verdict = checkUpgrade(request, { origin: options.origin, callerOrigin: options.callerOrigin });
    if (!verdict.accepted) {
      void logger.log("WARN", SOCKET_LOG_MODULE, `Refused helper socket upgrade: ${verdict.reason}`);
      socket.end(verdict.response, () => socket.destroy());
      return;
    }
    socket.write(verdict.response);
    const connection = new HelperConnection(socket, hooks);
    connections.add(connection);
    if (head.length > 0) { socket.unshift(head); }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const { port } = server.address() as AddressInfo;
  void logger.log("INFO", SOCKET_LOG_MODULE, "Helper socket listening", { port });

  let closed: Promise<void> | undefined;
  return {
    port,
    close: () => {
      closed ??= new Promise<void>((resolve) => {
        for (const connection of connections) { connection.destroy(); }
        server.close(() => resolve());
      });
      return closed;
    },
  };
}
