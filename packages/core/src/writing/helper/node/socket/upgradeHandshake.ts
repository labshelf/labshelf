// Checks a WebSocket upgrade request against the session's origin rules and builds the RFC 6455 answer.
// CONTRACT: documents/contracts/helper.md#transport
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

const ACCEPT_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension):\/\/[^/]+$/;

export interface UpgradeRules {
  origin: string;
  callerOrigin?: string | undefined;
}

export type UpgradeVerdict = { accepted: true; response: string } | { accepted: false; reason: string; response: string };

// PLATFORM: Chrome passes the caller origin as `chrome-extension://<id>/`, with a trailing slash the Origin header lacks.
function normaliseOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

function refuse(reason: string, status = "403 Forbidden"): UpgradeVerdict {
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
export function checkUpgrade(request: IncomingMessage, rules: UpgradeRules): UpgradeVerdict {
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
