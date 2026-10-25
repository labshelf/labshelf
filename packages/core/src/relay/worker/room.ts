// Holds one share as a Durable Object: its claim, and the sockets whose messages it stores and forwards.

import {
  decodeClientMessage, encodeRelayMessage, RELAY_ERROR_CODE, type RelayClientMessage, type RelayServerMessage,
} from "../connection/index.js";
import { openSocketPair, upgradeResponse, type HibernatingSocket, type RoomState } from "./cloudflareRuntime.js";
import { MAX_STORED_FRAME_BYTES, RoomStorage } from "./roomStorage.js";

/** The paths the Worker uses to ask a share's Durable Object about its claim; the body is the relay-token hash. */
export const ROOM_PATH = { claim: "/claim", check: "/check" } as const;

const peerIdOf = (socket: HibernatingSocket): number => (socket.deserializeAttachment() as { id: number }).id;

function send(socket: HibernatingSocket, message: RelayServerMessage): void {
  try {
    socket.send(encodeRelayMessage(message));
  } catch (error) {
    // A socket can close between listing and sending; the peer catches up with `since` when it reconnects.
    console.warn(`relay room: sending ${message.type} to peer ${peerIdOf(socket)} failed: ${String(error)}`);
  }
}

export class Room {
  private readonly storage: RoomStorage;

  constructor(private readonly ctx: RoomState) {
    this.storage = new RoomStorage(ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const { client, server } = openSocketPair();
      this.admit(server);
      return upgradeResponse(client);
    }
    const path = new URL(request.url).pathname;
    const tokenHash = await request.text();
    if (path === ROOM_PATH.claim) { return new Response(null, { status: this.storage.claim(tokenHash) ? 200 : 409 }); }
    if (path === ROOM_PATH.check) { return new Response(null, { status: this.storage.tokenHash() === tokenHash ? 200 : 403 }); }
    return new Response(null, { status: 404 });
  }

  /** Accepts a server socket with the Hibernation API and introduces it to the peers already connected. */
  admit(socket: HibernatingSocket): void {
    const id = this.storage.nextPeerId();
    const others = this.ctx.getWebSockets();
    this.ctx.acceptWebSocket(socket);
    socket.serializeAttachment({ id });
    send(socket, { type: "peers", ids: others.map(peerIdOf) });
    for (const other of others) { send(other, { type: "joined", id }); }
  }

  webSocketMessage(socket: HibernatingSocket, message: string | ArrayBuffer): void {
    // CONTRACT: documents/contracts/relay.md#socket-messages — a text message is ignored.
    if (typeof message === "string") { return; }
    const decoded = decodeClientMessage(new Uint8Array(message));
    if (decoded.ok) { this.handle(socket, decoded.message); return; }
    if (decoded.error === "unknownType") { return; }
    const code = decoded.error === "tooShort" ? "malformed" : decoded.error;
    send(socket, { type: "error", code: RELAY_ERROR_CODE[code] });
  }

  webSocketClose(socket: HibernatingSocket): void {
    // PLATFORM: from compatibility date 2026-04-07 the runtime answers the close frame itself, so the socket is not closed here.
    const id = peerIdOf(socket);
    for (const other of this.others(socket)) { send(other, { type: "left", id }); }
  }

  webSocketError(socket: HibernatingSocket, error: unknown): void {
    console.warn(`relay room: socket of peer ${peerIdOf(socket)} failed: ${String(error)}`);
    this.webSocketClose(socket);
  }

  private others(socket: HibernatingSocket): HibernatingSocket[] {
    return this.ctx.getWebSockets().filter((other) => other !== socket);
  }

  private handle(socket: HibernatingSocket, message: RelayClientMessage): void {
    const from = peerIdOf(socket);
    if ((message.type === "put" || message.type === "snapshot") && message.frame.length > MAX_STORED_FRAME_BYTES) {
      send(socket, { type: "error", code: RELAY_ERROR_CODE.tooLarge, doc: message.doc });
      return;
    }
    switch (message.type) {
      case "put": {
        const cursor = this.storage.put(message.doc, message.frame);
        send(socket, { type: "accepted", doc: message.doc, cursor });
        for (const other of this.others(socket)) { send(other, { type: "stored", from, doc: message.doc, cursor, frame: message.frame }); }
        return;
      }
      case "since": send(socket, this.storage.since(message.doc, message.cursor)); return;
      case "snapshot":
        send(socket, this.storage.snapshot(message.doc, message.covers, message.frame)
          ? { type: "accepted", doc: message.doc, cursor: message.covers }
          : { type: "error", code: RELAY_ERROR_CODE.staleSnapshot, doc: message.doc });
        return;
      case "forward":
        for (const other of this.others(socket)) {
          if (message.to === 0 || peerIdOf(other) === message.to) { send(other, { type: "forwarded", from, frame: message.frame }); }
        }
        return;
    }
  }
}
