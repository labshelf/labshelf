/** Pins the JSON bodies of the relay endpoints: encoding, validation of hostile bodies and version handling. */
import {
  decodeClaimRequest, decodeClaimResponse, decodeRefusal, decodeTicketRequest, decodeTicketResponse, decodeTurnRequest,
  decodeTurnResponse, decodeVersionResponse, encodeRelayBody,
} from "../../../src/relay/index";

const shareId = "0123456789abcdef0123456789abcdef";
const relayTokenHash = "ab".repeat(32);
const relayToken = "A".repeat(42) + "w";
const body = (text: string): unknown => JSON.parse(text);

describe("relay HTTP bodies", () => {
  it("adds the protocol version to every body", () => {
    expect(body(encodeRelayBody({ shareId, relayToken }))).toEqual({ v: "1.1", shareId, relayToken });
  });

  it("round-trips every request the Worker reads", () => {
    expect(decodeClaimRequest(body(encodeRelayBody({ shareId, relayTokenHash })))).toEqual({ ok: true, value: { v: "1.1", shareId, relayTokenHash } });
    expect(decodeTicketRequest(body(encodeRelayBody({ shareId, relayToken })))).toEqual({ ok: true, value: { v: "1.1", shareId, relayToken } });
    expect(decodeTurnRequest(body(encodeRelayBody({ shareId, ticket: "1700000000.abc_-" })))).toEqual({
      ok: true, value: { v: "1.1", shareId, ticket: "1700000000.abc_-" },
    });
  });

  it("round-trips every answer a client reads", () => {
    expect(decodeVersionResponse(body(encodeRelayBody({ worker: "1.1.4" })))).toEqual({ ok: true, value: { v: "1.1", worker: "1.1.4" } });
    expect(decodeClaimResponse(body(encodeRelayBody({})))).toEqual({ ok: true, value: { v: "1.1" } });
    expect(decodeTicketResponse(body(encodeRelayBody({ ticket: "1.a", expires: 1700000300 })))).toEqual({
      ok: true, value: { v: "1.1", ticket: "1.a", expires: 1700000300 },
    });
    const iceServers = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: ["turn:a:3478", "turns:a:443"], username: "u", credential: "c" }];
    expect(decodeTurnResponse(body(encodeRelayBody({ iceServers, expires: 1700003600 })))).toEqual({
      ok: true, value: { v: "1.1", iceServers, expires: 1700003600 },
    });
    expect(decodeRefusal(body(encodeRelayBody({ error: "forbidden" })))).toEqual({ ok: true, value: { v: "1.1", error: "forbidden" } });
  });

  it("refuses hostile request bodies with malformed", () => {
    const bad: unknown[] = [
      null, 3, "x", [], {},
      { v: "1.1", shareId: shareId.toUpperCase(), relayTokenHash },
      { v: "1.1", shareId, relayTokenHash: "ab" },
      { v: "1.1", shareId: shareId + "00", relayTokenHash },
      { v: 1, shareId, relayTokenHash },
      { v: "1.1", shareId, relayTokenHash: 5 },
    ];
    for (const value of bad) { expect(decodeClaimRequest(value)).toEqual({ ok: false, error: "malformed" }); }
    expect(decodeTicketRequest({ v: "1.1", shareId, relayToken: "short" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketRequest({ v: "1.1", shareId, relayToken: "+".repeat(43) })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnRequest({ v: "1.1", shareId, ticket: "" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnRequest({ v: "1.1", shareId, ticket: "x".repeat(257) })).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses hostile answers with malformed", () => {
    expect(decodeVersionResponse({ v: "1.1", worker: "1.0" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeVersionResponse({ v: "1.1", worker: "1.2.0" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketResponse({ v: "1.1", ticket: "t", expires: -1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketResponse({ v: "1.1", ticket: "t", expires: 1.5 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnResponse({ v: "1.1", iceServers: {}, expires: 1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnResponse({ v: "1.1", iceServers: [{ urls: [] }], expires: 1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnResponse({ v: "1.1", iceServers: [{ urls: "turn:a", username: 3 }], expires: 1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTurnResponse({ v: "1.1", iceServers: Array(17).fill({ urls: "stun:a" }), expires: 1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeRefusal({ v: "1.1" })).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses another major: the Worker says incompatibleVersion, a client incompatibleRelay", () => {
    expect(decodeClaimRequest({ v: "2.0", shareId, relayTokenHash })).toEqual({ ok: false, error: "incompatibleVersion" });
    expect(decodeVersionResponse({ v: "2.0", worker: "2.0.0" })).toEqual({ ok: false, error: "incompatibleRelay", worker: "2.0" });
    expect(decodeTicketResponse({ v: "3.1", ticket: "t", expires: 1 })).toEqual({ ok: false, error: "incompatibleRelay", worker: "3.1" });
  });

  it("lets a newer minor client talk to an older Worker and the reverse: unknown keys are ignored", () => {
    expect(decodeTicketRequest({ v: "1.4", shareId, relayToken, device: "laptop" })).toEqual({ ok: true, value: { v: "1.4", shareId, relayToken } });
    expect(decodeVersionResponse({ v: "1.1", worker: "1.1.9", region: "eu" })).toEqual({ ok: true, value: { v: "1.1", worker: "1.1.9" } });
    expect(decodeTurnResponse({ v: "1.2", iceServers: [{ urls: "stun:a", priority: 1 }], expires: 1 })).toEqual({
      ok: true, value: { v: "1.2", iceServers: [{ urls: "stun:a" }], expires: 1 },
    });
    expect(decodeRefusal({ v: "1.3", error: "rateLimited" })).toEqual({ ok: true, value: { v: "1.3", error: "rateLimited" } });
  });
});
