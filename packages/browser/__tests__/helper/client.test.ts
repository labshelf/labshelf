// Pins the WebSocket transport to LabShelf Helper: binary frames, the session url, text frames and a socket that closes before opening.
import { decodeConnectionMessage, encodeConnectionMessage, PROTOCOL_VERSION } from "@labshelf/core/helper";
import { openHelperSocket, type HelperConnectionConstructor } from "../../src/helper/client";

class FakeSocket {
  static last: FakeSocket | undefined;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Uint8Array[] = [];
  closed = false;
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(bytes: Uint8Array): void { this.sent.push(bytes); }
  close(): void { this.closed = true; }
}
const Socket = FakeSocket as unknown as HelperConnectionConstructor;

async function opened() {
  const pending = openHelperSocket("ws://127.0.0.1:4321/", Socket);
  const socket = FakeSocket.last!;
  socket.onopen?.();
  return { socket, transport: await pending };
}

it("opens the url in arraybuffer mode and frames messages with their payload", async () => {
  const { socket, transport } = await opened();
  expect(socket.url).toBe("ws://127.0.0.1:4321/");
  expect(socket.binaryType).toBe("arraybuffer");
  transport.post({ type: "templateThumbnail", requestId: "3" }, Uint8Array.of(1, 2));
  expect(decodeConnectionMessage(socket.sent[0]!)).toEqual({ envelope: { type: "templateThumbnail", requestId: "3" }, payload: Uint8Array.of(1, 2) });
  transport.close();
  expect(socket.closed).toBe(true);
});

it("decodes binary frames and reports a text frame as an unreadable message", async () => {
  const { socket, transport } = await opened();
  const received: Array<[unknown, Uint8Array]> = [];
  transport.onMessage((message, payload) => received.push([message, payload]));
  const bytes = encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "1", type: "authed" }, Uint8Array.of(7));
  socket.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  socket.onmessage?.({ data: "hello" });
  expect(received).toEqual([[{ v: PROTOCOL_VERSION, id: "1", type: "authed" }, Uint8Array.of(7)], ["a text frame", new Uint8Array(0)]]);
});

it("reports the close reason, or the code when there is none, after opening", async () => {
  const { socket, transport } = await opened();
  const reasons: Array<string | undefined> = [];
  transport.onClose((reason) => reasons.push(reason));
  socket.onclose?.({ code: 1006, reason: "" });
  expect(reasons).toEqual(["WebSocket closed with code 1006"]);
});

it("rejects with did not open when the socket closes before opening", async () => {
  const pending = openHelperSocket("ws://127.0.0.1:4321/", Socket);
  FakeSocket.last!.onclose?.({ code: 1006, reason: "refused" });
  await expect(pending).rejects.toThrow("LabShelf Helper socket did not open: refused");
});
