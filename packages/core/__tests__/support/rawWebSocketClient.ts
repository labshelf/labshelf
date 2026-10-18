/** A minimal RFC 6455 client over node:net that can set Origin and send text or oversized frames. */
import { randomBytes } from "node:crypto";
import * as net from "node:net";

export interface RawUpgrade { status: number; headers: string; client: RawWebSocketClient }

export class RawWebSocketClient {
  /** Resolves when the TCP connection ends, whoever closed it. */
  readonly closed: Promise<void>;
  private buffer = Buffer.alloc(0);
  private readonly messages: Buffer[] = [];
  private waiting: Array<(message: Buffer) => void> = [];
  private upgraded = false;
  private onUpgrade!: (status: number, headers: string) => void;

  private constructor(private readonly socket: net.Socket) {
    this.closed = new Promise((resolve) => socket.once("close", () => resolve()));
    socket.on("error", () => undefined);
    socket.on("data", (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.pump(); });
  }

  /** Opens the TCP connection and performs the upgrade; `status` is the HTTP status of the answer (101 on success). */
  static connect(port: number, origin: string | undefined, extraHeaders: string[] = []): Promise<RawUpgrade> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1");
      const client = new RawWebSocketClient(socket);
      client.onUpgrade = (status, headers) => resolve({ status, headers, client });
      socket.once("error", reject);
      socket.once("close", () => resolve({ status: 0, headers: "", client }));
      const key = randomBytes(16).toString("base64");
      const lines = [
        "GET / HTTP/1.1", `Host: 127.0.0.1:${port}`, "Upgrade: websocket", "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`, "Sec-WebSocket-Version: 13",
        ...(origin === undefined ? [] : [`Origin: ${origin}`]), ...extraHeaders,
      ];
      socket.once("connect", () => socket.write(`${lines.join("\r\n")}\r\n\r\n`));
    });
  }

  /** `rsv` sets reserved bits in the first byte, e.g. 0x40 for RSV1. */
  sendBinary(bytes: Uint8Array, rsv = 0): void { this.send(0x2 | rsv, bytes); }
  sendText(text: string): void { this.send(0x1, Buffer.from(text)); }

  /** The next binary message the server sends. */
  nextMessage(): Promise<Buffer> {
    const ready = this.messages.shift();
    return ready ? Promise.resolve(ready) : new Promise((resolve) => this.waiting.push(resolve));
  }

  destroy(): void { this.socket.destroy(); }

  private send(opcode: number, data: Uint8Array): void {
    const mask = randomBytes(4);
    const length = data.length;
    const header = length < 126 ? Buffer.from([0x80 | opcode, 0x80 | length])
      : length < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, length >> 8, length & 255])
        : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), Buffer.alloc(8)]);
    if (length >= 65536) { header.writeBigUInt64BE(BigInt(length), 2); }
    const body = Buffer.from(data);
    for (let i = 0; i < body.length; i += 1) { body[i] = body[i]! ^ mask[i % 4]!; }
    this.socket.write(Buffer.concat([header, mask, body]));
  }

  private pump(): void {
    if (!this.upgraded) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) { return; }
      const headers = this.buffer.toString("latin1", 0, end);
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(headers)?.[1] ?? 0);
      this.buffer = this.buffer.subarray(end + 4);
      this.upgraded = true;
      this.onUpgrade(status, headers);
    }
    for (;;) {
      if (this.buffer.length < 2) { return; }
      let length = this.buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) { if (this.buffer.length < 4) { return; } length = this.buffer.readUInt16BE(2); offset = 4; }
      if (length === 127) { if (this.buffer.length < 10) { return; } length = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
      if (this.buffer.length < offset + length) { return; }
      const opcode = this.buffer[0]! & 0x0f;
      const payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode !== 0x2) { continue; }
      const waiter = this.waiting.shift();
      if (waiter) { waiter(Buffer.from(payload)); } else { this.messages.push(Buffer.from(payload)); }
    }
  }
}
