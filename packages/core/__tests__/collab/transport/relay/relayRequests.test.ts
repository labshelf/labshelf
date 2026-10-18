/** Pins the ticket and TURN requests: the bodies sent, the trystero turnConfig shape, and typed refusals. */
import { fetchTicket, fetchTurnServers, RelayRequestError } from "../../../../src/collab/transport/index";

const SHARE_ID = "a".repeat(32);

function answering(status: number, body: unknown, seen: { url: string; body: unknown }[] = []): typeof fetch {
  return async (input, init) => {
    seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  };
}

describe("relay requests", () => {
  it("maps the relay's ICE servers to trystero's turnConfig", async () => {
    const seen: { url: string; body: unknown }[] = [];
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
