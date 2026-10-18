/** Pins the claim, ticket and TURN requests: the bodies sent, the trystero turnConfig shape, and typed refusals. */
import { createHash } from "node:crypto";
import { claimShare, fetchTicket, fetchTurnServers, RelayRequestError } from "../../../../src/collab/transport/index";

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
    await claimShare({
      relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: token.toString("base64url"), fetch: answering(200, { v: "1.0" }, seen),
    });
    const relayTokenHash = createHash("sha256").update(token).digest("hex");
    expect(seen).toEqual([{ url: "https://relay.example/claim", body: { v: "1.0", shareId: SHARE_ID, relayTokenHash }, authorization: "Bearer owner" }]);
    const claimed = claimShare({ relayUrl: "https://relay.example", ownerSecret: "owner", shareId: SHARE_ID, relayToken: "AA", fetch: answering(409, { v: "1.0", error: "claimed" }) });
    await expect(claimed).rejects.toMatchObject({ code: "claimed", status: 409 });
  });

  it("maps the relay's ICE servers to trystero's turnConfig", async () => {
    const seen: Seen[] = [];
    const iceServers = [{ urls: ["turn:turn.example:3478"], username: "u", credential: "c" }, { urls: "stun:stun.example" }];
    const servers = await fetchTurnServers({
      relayUrl: "https://relay.example/", shareId: SHARE_ID, ticket: "1.mac", fetch: answering(200, { v: "1.0", iceServers, expires: 1_900_000_000 }, seen),
    });
    expect(seen).toEqual([{ url: "https://relay.example/turn", body: { v: "1.0", shareId: SHARE_ID, ticket: "1.mac" } }]);
    expect(servers).toEqual([
      { urls: ["turn:turn.example:3478"], username: "u", credential: "c" },
      { urls: "stun:stun.example", username: undefined, credential: undefined },
    ]);
  });

  it("names a refusal and a relay of another major", async () => {
    const refused = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(403, { v: "1.0", error: "forbidden" }) });
    await expect(refused).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const newer = fetchTicket({ relayUrl: "https://relay.example", shareId: SHARE_ID, relayToken: "t", fetch: answering(200, { v: "2.0", ticket: "x", expires: 1 }) });
    await expect(newer).rejects.toBeInstanceOf(RelayRequestError);
    await expect(newer).rejects.toMatchObject({ code: "incompatibleRelay" });
  });
});
