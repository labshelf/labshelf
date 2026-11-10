/** Pins the JSON bodies of the relay endpoints: encoding, validation of hostile bodies and version handling. */
import {
  decodeClaimRequest, decodeClaimResponse, decodeRefusal, decodeTicketRequest, decodeTicketResponse, decodeVersionResponse, encodeRelayBody, RELAY_PROTOCOL_VERSION,
} from "../../src/relay/index";

const shareId = "0123456789abcdef0123456789abcdef";
const relayTokenHash = "ab".repeat(32);
const relayToken = "A".repeat(42) + "w";
const body = (text: string): unknown => JSON.parse(text);

describe("relay HTTP bodies", () => {
  it("adds the protocol version to every body", () => {
    expect(body(encodeRelayBody({ shareId, relayToken }))).toEqual({ v: RELAY_PROTOCOL_VERSION, shareId, relayToken });
  });

  it("round-trips every request the Worker reads", () => {
    expect(decodeClaimRequest(body(encodeRelayBody({ shareId, relayTokenHash })))).toEqual({ ok: true, value: { v: RELAY_PROTOCOL_VERSION, shareId, relayTokenHash } });
    expect(decodeTicketRequest(body(encodeRelayBody({ shareId, relayToken })))).toEqual({ ok: true, value: { v: RELAY_PROTOCOL_VERSION, shareId, relayToken } });
  });

  it("round-trips every answer a client reads", () => {
    expect(decodeVersionResponse(body(encodeRelayBody({ worker: `${RELAY_PROTOCOL_VERSION}.4` })))).toEqual({ ok: true, value: { v: RELAY_PROTOCOL_VERSION, worker: `${RELAY_PROTOCOL_VERSION}.4` } });
    expect(decodeClaimResponse(body(encodeRelayBody({})))).toEqual({ ok: true, value: { v: RELAY_PROTOCOL_VERSION } });
    expect(decodeTicketResponse(body(encodeRelayBody({ ticket: "1.a", expires: 1700000300 })))).toEqual({
      ok: true, value: { v: RELAY_PROTOCOL_VERSION, ticket: "1.a", expires: 1700000300 },
    });
    expect(decodeRefusal(body(encodeRelayBody({ error: "forbidden" })))).toEqual({ ok: true, value: { v: RELAY_PROTOCOL_VERSION, error: "forbidden" } });
  });

  it("refuses hostile request bodies with malformed", () => {
    const bad: unknown[] = [
      null, 3, "x", [], {},
      { v: RELAY_PROTOCOL_VERSION, shareId: shareId.toUpperCase(), relayTokenHash },
      { v: RELAY_PROTOCOL_VERSION, shareId, relayTokenHash: "ab" },
      { v: RELAY_PROTOCOL_VERSION, shareId: shareId + "00", relayTokenHash },
      { v: 1, shareId, relayTokenHash },
      { v: RELAY_PROTOCOL_VERSION, shareId, relayTokenHash: 5 },
    ];
    for (const value of bad) { expect(decodeClaimRequest(value)).toEqual({ ok: false, error: "malformed" }); }
    expect(decodeTicketRequest({ v: RELAY_PROTOCOL_VERSION, shareId, relayToken: "short" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketRequest({ v: RELAY_PROTOCOL_VERSION, shareId, relayToken: "+".repeat(43) })).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses hostile answers with malformed", () => {
    expect(decodeVersionResponse({ v: RELAY_PROTOCOL_VERSION, worker: "1.0" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeVersionResponse({ v: RELAY_PROTOCOL_VERSION, worker: "1.2.0" })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketResponse({ v: RELAY_PROTOCOL_VERSION, ticket: "t", expires: -1 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeTicketResponse({ v: RELAY_PROTOCOL_VERSION, ticket: "t", expires: 1.5 })).toEqual({ ok: false, error: "malformed" });
    expect(decodeRefusal({ v: RELAY_PROTOCOL_VERSION })).toEqual({ ok: false, error: "malformed" });
  });

  it("refuses another major: the Worker says incompatibleVersion, a client incompatibleRelay", () => {
    expect(decodeClaimRequest({ v: "9.0", shareId, relayTokenHash })).toEqual({ ok: false, error: "incompatibleVersion" });
    expect(decodeVersionResponse({ v: "9.0", worker: "9.0.0" })).toEqual({ ok: false, error: "incompatibleRelay", worker: "9.0" });
    expect(decodeTicketResponse({ v: "3.1", ticket: "t", expires: 1 })).toEqual({ ok: false, error: "incompatibleRelay", worker: "3.1" });
  });

  it("lets a newer minor client talk to an older Worker and the reverse: unknown keys are ignored", () => {
    expect(decodeTicketRequest({ v: "2.4", shareId, relayToken, device: "laptop" })).toEqual({ ok: true, value: { v: "2.4", shareId, relayToken } });
    expect(decodeVersionResponse({ v: "2.1", worker: "2.1.9", region: "eu" })).toEqual({ ok: true, value: { v: "2.1", worker: "2.1.9" } });
    expect(decodeRefusal({ v: "2.3", error: "rateLimited" })).toEqual({ ok: true, value: { v: "2.3", error: "rateLimited" } });
  });
});
