/** Pins the claim and ticket requests: the bodies sent and typed refusals. */
import { createHash } from "node:crypto";
import { addRelayShare, fetchTicket, RelayRequestError } from "../../../../src/collab/transport/index";

const SHARE_ID = "a".repeat(32);

interface Seen { url: string; body: unknown; authorization?: string }

function answering(status: number, body: unknown, seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const authorization = (init?.headers as Record<string, string> | undefined)?.authorization;
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)), ...(authorization ? { authorization } : {}) });
    return new Response(JSON.stringify(body), { status });
  };
}

describe("relay requests", () => {
  it("claims a share with the owner secret and the SHA-256 hex of the relay token's decoded bytes", async () => {
    const seen: Seen[] = [];
    const token = Buffer.alloc(32, 7);
    await addRelayShare({
      relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: token.toString("base64url"), fetch: answering(200, { v: "2.0" }, seen),
    });
    const relayTokenHash = createHash("sha256").update(token).digest("hex");
    expect(seen).toEqual([{ url: "https://relay.example/claim", body: { v: "2.0", shareId: SHARE_ID, relayTokenHash }, authorization: "Bearer owner" }]);
    const claimed = addRelayShare({ relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: "AA", fetch: answering(409, { v: "2.0", error: "claimed" }) });
    await expect(claimed).rejects.toMatchObject({ code: "claimed", status: 409 });
  });

  it("names a refusal and a relay of another major", async () => {
    const refused = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(403, { v: "2.0", error: "forbidden" }) });
    await expect(refused).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const newer = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(200, { v: "3.0", ticket: "x", expires: 1 }) });
    await expect(newer).rejects.toBeInstanceOf(RelayRequestError);
    await expect(newer).rejects.toMatchObject({ code: "incompatibleRelay" });
  });

  it.each([
    ["a 503 HTML page", 503, "<html><body>Service Unavailable</body></html>"],
    ["a 502 empty body", 502, ""],
    ["a 200 HTML page", 200, "<html>captive portal</html>"],
  ])("names %s from /ticket a relayDown refusal with the status", async (_name, status, body) => {
    const down: typeof fetch = async () => new Response(body, { status });
    const refused = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: down });
    await expect(refused).rejects.toMatchObject({ code: "relayDown", status });
    await expect(refused).rejects.toThrow(`HTTP ${status}`);
  });

  it("names a 5xx that carries JSON a relayDown refusal and a failed fetch a network error", async () => {
    const failing = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(500, { v: "2.0", error: "internal" }) });
    await expect(failing).rejects.toMatchObject({ code: "relayDown", status: 500 });
    const offline: typeof fetch = async () => { throw new TypeError("fetch failed"); };
    await expect(fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: offline })).rejects.toMatchObject({ code: "network", status: 0 });
  });
});
