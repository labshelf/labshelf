/** Pins the relay Worker's endpoints: version, owner-only claims, tickets bound to a share and time, TURN minting. */
import { bytesToBase64Url, bytesToHex } from "../../../src/encoding/index";
import { RELAY_WORKER_BUILD } from "../../../src/relay/index";
import worker from "../../../src/relay/worker/index";
import { fakeEnv, OWNER_SECRET } from "./fakeRoomRuntime";

const shareId = "0123456789abcdef0123456789abcdef";
const otherShare = "fedcba9876543210fedcba9876543210";
const tokenBytes = new Uint8Array(32).fill(5);
const relayToken = bytesToBase64Url(tokenBytes);
const BASE = "https://relay.example.workers.dev";

async function tokenHash(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const owner = { Authorization: `Bearer ${OWNER_SECRET}` };

async function claimed(overrides = {}) {
  const fake = fakeEnv(overrides);
  const response = await worker.fetch(post("/claim", { v: "1.0", shareId, relayTokenHash: await tokenHash(tokenBytes) }, owner), fake.env);
  expect(response.status).toBe(200);
  return fake;
}

async function ticketFor(fake: ReturnType<typeof fakeEnv>, id = shareId): Promise<string> {
  const response = await worker.fetch(post("/ticket", { v: "1.0", shareId: id, relayToken }), fake.env);
  expect(response.status).toBe(200);
  return ((await response.json()) as { ticket: string }).ticket;
}

const upgrade = (id: string, ticket: string) =>
  new Request(`${BASE}/project/${id}?ticket=${encodeURIComponent(ticket)}`, { headers: { Upgrade: "websocket" } });

afterEach(() => { jest.restoreAllMocks(); });

describe("relay worker", () => {
  it("reports its build and answers CORS preflights", async () => {
    const { env } = fakeEnv();
    const version = await worker.fetch(new Request(`${BASE}/version`), env);
    expect(await version.json()).toEqual({ v: "1.0", worker: RELAY_WORKER_BUILD });
    expect(version.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await worker.fetch(new Request(`${BASE}/claim`, { method: "OPTIONS" }), env)).status).toBe(204);
  });

  it("claims a share only with the owner secret, and only once per hash", async () => {
    const { env } = fakeEnv();
    const body = { v: "1.0", shareId, relayTokenHash: await tokenHash(tokenBytes) };
    expect((await worker.fetch(post("/claim", body), env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", body, { Authorization: "Bearer wrong" }), env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", body, owner), env)).status).toBe(200);
    expect((await worker.fetch(post("/claim", body, owner), env)).status).toBe(200);
    const other = await worker.fetch(post("/claim", { ...body, relayTokenHash: "0".repeat(64) }, owner), env);
    expect([other.status, await other.json()]).toEqual([409, { v: "1.0", error: "claimed" }]);
    expect((await worker.fetch(post("/claim", { ...body, v: "2.0" }, owner), env)).status).toBe(400);
  });

  it("refuses a ticket for an unclaimed share or a wrong relay token", async () => {
    const fake = await claimed();
    const wrong = await worker.fetch(post("/ticket", { v: "1.0", shareId, relayToken: bytesToBase64Url(new Uint8Array(32)) }), fake.env);
    expect([wrong.status, await wrong.json()]).toEqual([403, { v: "1.0", error: "forbidden" }]);
    expect((await worker.fetch(post("/ticket", { v: "1.0", shareId: otherShare, relayToken }), fake.env)).status).toBe(403);
  });

  it("opens the share's socket with its ticket and refuses a bad, foreign or expired one", async () => {
    const fake = await claimed();
    const ticket = await ticketFor(fake);
    expect((await worker.fetch(upgrade(shareId, ticket), fake.env)).status).toBe(200);
    expect(fake.upgrades).toHaveLength(1);
    expect((await worker.fetch(upgrade(otherShare, ticket), fake.env)).status).toBe(401);
    expect((await worker.fetch(upgrade(shareId, `${ticket.slice(0, -1)}${ticket.endsWith("A") ? "E" : "A"}`), fake.env)).status).toBe(401);
    expect((await worker.fetch(upgrade(shareId, "garbage"), fake.env)).status).toBe(401);
    expect((await worker.fetch(post("/claim", {}), fakeEnv({ OWNER_SECRET: "another" }).env)).status).toBe(401);
    const expired = Date.now() + 301 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(expired);
    expect((await worker.fetch(upgrade(shareId, ticket), fake.env)).status).toBe(401);
    expect(fake.upgrades).toHaveLength(1);
  });

  it("mints TURN credentials for a valid ticket and refuses when no TURN key is set", async () => {
    const iceServers = [{ urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }];
    const upstream = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ iceServers }), { status: 201 }));
    const fake = await claimed({ TURN_KEY_ID: "key-id", TURN_KEY_SECRET: "key-secret" });
    const ticket = await ticketFor(fake);
    const response = await worker.fetch(post("/turn", { v: "1.0", shareId, ticket }), fake.env);
    expect(await response.json()).toEqual({ v: "1.0", iceServers, expires: expect.any(Number) });
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe("https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers");
    expect(init).toMatchObject({ method: "POST", headers: { Authorization: "Bearer key-secret" }, body: JSON.stringify({ ttl: 3600 }) });
    expect((await worker.fetch(post("/turn", { v: "1.0", shareId, ticket: "1.x" }), fake.env)).status).toBe(401);
    const bare = await claimed();
    const refused = await worker.fetch(post("/turn", { v: "1.0", shareId, ticket: await ticketFor(bare) }), bare.env);
    expect([refused.status, await refused.json()]).toEqual([503, { v: "1.0", error: "turnUnavailable" }]);
  });
});
