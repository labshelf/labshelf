/** Pins the relay inbox: who may post (inbox token or directory signature), its caps, and the owner's list and delete. */
import { canonicalJson } from "../../../src/collab/invite/identity";
import { deleteInvite, inboxToken, listInbox, postInvite } from "../../../src/collab/relays/relayInbox";
import { RelayRequestError } from "../../../src/collab/relays/relayTransport";
import { bytesToBase64Url } from "../../../src/encoding/index";
import { RELAY_MIGRATIONS } from "../../../src/relay/relayPaths";
import { answerRelayRequest } from "../../../src/relay/worker/answerRelayRequest";
import { fakeEnv, OWNER_SECRET } from "./fakeRoomRuntime";

const RELAY = "https://relay.test";
const RECIPIENT = "recipientFingerprint00";
const encoder = new TextEncoder();
const HOUR = 3600 * 1000;

type Sealed = { v: number; to: string; expires: number; epk: string; iv: string; ct: string };

const sealedFor = (n: number | string, overrides: Partial<Sealed> = {}): Sealed =>
  ({ v: 1, to: RECIPIENT, expires: Date.now() + 30 * 24 * HOUR, epk: `epk-${n}`, iv: "iv", ct: "ct", ...overrides });

async function generateDirectoryKey() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  return { privateKey: pair.privateKey, publicKey };
}

const sha256Url = async (text: string) => bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));

/** Signs a forward the way the directory does (documents/contracts/directory.md#forward). */
async function signForward(privateKey: CryptoKey, sealed: Sealed, ts: number, to = sealed.to): Promise<string> {
  const message = `labshelf-directory-forward-v1\n${to}\n${await sha256Url(canonicalJson(sealed))}\n${ts}`;
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(message))));
}

let directory: Awaited<ReturnType<typeof generateDirectoryKey>>;
let stranger: Awaited<ReturnType<typeof generateDirectoryKey>>;
let token: string;

beforeAll(async () => {
  directory = await generateDirectoryKey();
  stranger = await generateDirectoryKey();
  token = await inboxToken(OWNER_SECRET, RECIPIENT);
});

function setup() {
  const fake = fakeEnv();
  const call = (request: Request) => answerRelayRequest(request, fake.env, { directoryPublicKey: directory.publicKey });
  const post = (body: unknown, bearer?: string) => call(new Request(`${RELAY}/inbox`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  }));
  const list = (secret = OWNER_SECRET) => call(new Request(`${RELAY}/inbox`, { headers: { authorization: `Bearer ${secret}` } }));
  const remove = (id: string, secret = OWNER_SECRET) =>
    call(new Request(`${RELAY}/inbox/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${secret}` } }));
  const fetchFn = ((input: string, init?: RequestInit) => answerRelayRequest(new Request(input, init), fake.env)) as typeof fetch;
  return { ...fake, post, list, remove, fetchFn };
}

const signedBody = async (sealed: Sealed, from = "sender-a", ts = Date.now()) =>
  ({ sealed, from, ts, sig: await signForward(directory.privateKey, sealed, ts) });

async function pendingCount(list: () => Promise<Response>): Promise<number> {
  return ((await (await list()).json()) as { invites: unknown[] }).invites.length;
}

describe("inbox token", () => {
  it("is base64url HMAC-SHA-256 of the fingerprint under HKDF(owner secret, info inbox-token)", async () => {
    const base = await crypto.subtle.importKey("raw", encoder.encode(OWNER_SECRET), "HKDF", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("inbox-token") },
      base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"],
    );
    const expected = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(RECIPIENT))));
    expect(token).toBe(expected);
    expect(await inboxToken(OWNER_SECRET, "other")).not.toBe(expected);
    expect(await inboxToken("other-secret", RECIPIENT)).not.toBe(expected);
  });
});

describe("relay inbox POST proofs (A4)", () => {
  it("refuses a post with neither a token nor a signature before reaching the Durable Object", async () => {
    const { post, inboxCalls } = setup();
    const response = await post({ sealed: sealedFor(1), from: "sender-a" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ v: "2.1", error: "unauthorized" });
    expect(inboxCalls()).toBe(0);
  });

  it("refuses a signature by another key, over another recipient, over other content or too old", async () => {
    const { post, inboxCalls } = setup();
    const sealed = sealedFor(1);
    const ts = Date.now();
    const bodies = [
      { sealed, from: "sender-a", ts, sig: await signForward(stranger.privateKey, sealed, ts) },
      { sealed, from: "sender-a", ts, sig: await signForward(directory.privateKey, sealed, ts, "someoneElse") },
      { sealed: sealedFor(2), from: "sender-a", ts, sig: await signForward(directory.privateKey, sealed, ts) },
      { sealed, from: "sender-a", ts: ts + 1, sig: await signForward(directory.privateKey, sealed, ts) },
      await signedBody(sealed, "sender-a", ts - 11 * 60 * 1000),
      await signedBody(sealed, "sender-a", ts + 11 * 60 * 1000),
      { sealed, from: "sender-a", ts, sig: "not-a-signature" },
      { sealed, from: "sender-a", sig: await signForward(directory.privateKey, sealed, ts) },
    ];
    for (const body of bodies) {
      const response = await post(body);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe("unauthorized");
    }
    expect(inboxCalls()).toBe(0);
  });

  it("refuses a bearer that is not the inbox token of sealed.to, even with a valid signature", async () => {
    const { post, list } = setup();
    const sealed = sealedFor(1);
    const otherToken = await inboxToken(OWNER_SECRET, "someoneElse");
    for (const bearer of ["wrong-token", otherToken, await inboxToken("other-secret", RECIPIENT)]) {
      const response = await post(await signedBody(sealed), bearer);
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe("unauthorized");
    }
    expect(await pendingCount(list)).toBe(0);
  });

  it("refuses a body of another major and a malformed body", async () => {
    const { post } = setup();
    const incompatible = await post({ v: "3.0", sealed: sealedFor(1), from: "sender-a" }, token);
    expect(incompatible.status).toBe(400);
    expect(((await incompatible.json()) as { error: string }).error).toBe("incompatibleVersion");
    for (const body of [{ from: "sender-a" }, { sealed: "text", from: "sender-a" }, { sealed: sealedFor(1) }, { sealed: { expires: 1 }, from: "sender-a" }]) {
      const response = await post(body, token);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBe("malformed");
    }
  });
});

describe("relay inbox storage and caps (5.2a)", () => {
  it("stores an invite posted with the inbox token and answers its id", async () => {
    const { post, list } = setup();
    const sealed = sealedFor(1);
    const response = await post({ sealed, from: "sender-a" }, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ v: "2.1", id: await sha256Url(canonicalJson(sealed)) });
    const listed = (await (await list()).json()) as { invites: { sealed: unknown; from: string }[] };
    expect(listed.invites.map(({ sealed: held, from }) => ({ sealed: held, from }))).toEqual([{ sealed, from: "sender-a" }]);
  });

  it("stores an invite forwarded with a directory signature, with or without the token", async () => {
    const { post, list } = setup();
    expect((await post(await signedBody(sealedFor(1)))).status).toBe(200);
    expect((await post(await signedBody(sealedFor(2)), token)).status).toBe(200);
    const ts = Date.now() - 9 * 60 * 1000;
    expect((await post(await signedBody(sealedFor(3), "sender-a", ts))).status).toBe(200);
    expect(await pendingCount(list)).toBe(3);
  });

  it("answers ok again for an invite already held and counts nothing", async () => {
    const { post, list } = setup();
    const sealed = sealedFor(1);
    const first = (await (await post({ sealed, from: "sender-a" }, token)).json()) as { id: string };
    for (let index = 0; index < 12; index += 1) {
      const again = await post({ sealed, from: "sender-a" }, token);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ v: "2.1", id: first.id });
    }
    expect(await pendingCount(list)).toBe(1);
    expect((await post({ sealed: sealedFor(2), from: "sender-a" }, token)).status).toBe(200);
  });

  it("refuses the 51st pending invite as inboxFull", async () => {
    const { post, list } = setup();
    for (let index = 0; index < 50; index += 1) {
      const response = await post({ sealed: sealedFor(index), from: `sender-${index % 10}` }, token);
      expect(response.status).toBe(200);
    }
    const full = await post({ sealed: sealedFor(50), from: "sender-new" }, token);
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toBe("inboxFull");
    expect(await pendingCount(list)).toBe(50);
  });

  it("drops expired invites before checking the caps", async () => {
    const { post } = setup();
    const soon = Date.now() + 300;
    for (let index = 0; index < 50; index += 1) {
      expect((await post({ sealed: sealedFor(index, { expires: soon }), from: `sender-${index % 10}` }, token)).status).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await post({ sealed: sealedFor(50), from: "sender-new" }, token)).status).toBe(200);
  });

  it("refuses an invite whose canonical JSON is over 16 KiB as tooLarge", async () => {
    const { post, list } = setup();
    const response = await post({ sealed: sealedFor(1, { ct: "x".repeat(17 * 1024) }), from: "sender-a" }, token);
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toBe("tooLarge");
    expect(await pendingCount(list)).toBe(0);
    const base = canonicalJson(sealedFor(2, { ct: "" })).length;
    expect((await post({ sealed: sealedFor(2, { ct: "x".repeat(16384 - base) }), from: "sender-a" }, token)).status).toBe(200);
  });

  it("refuses the 11th invite of a sender in one UTC day as rateLimited, also after deletes", async () => {
    const { post, list, remove } = setup();
    for (let index = 0; index < 10; index += 1) {
      expect((await post({ sealed: sealedFor(index), from: "sender-a" }, token)).status).toBe(200);
    }
    const { invites } = (await (await list()).json()) as { invites: { id: string }[] };
    for (const { id } of invites) { await remove(id); }
    const limited = await post({ sealed: sealedFor(10), from: "sender-a" }, token);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("rateLimited");
    expect((await post({ sealed: sealedFor(11), from: "sender-b" }, token)).status).toBe(200);
  });

  it("brings the Inbox class in migration v2 after v1", () => {
    expect(RELAY_MIGRATIONS).toEqual([{ tag: "v1", new_sqlite_classes: ["Room"] }, { tag: "v2", new_sqlite_classes: ["Inbox"] }]);
  });
});

describe("relay inbox owner requests (5.2b)", () => {
  it("lists oldest first with ids, senders and receive times, and deletes", async () => {
    const { post, list, remove } = setup();
    const before = Date.now();
    const first = sealedFor(1);
    const second = sealedFor(2);
    await post({ sealed: first, from: "sender-a" }, token);
    await post(await signedBody(second, "sender-b"));
    const listed = (await (await list()).json()) as { v: string; invites: { id: string; sealed: unknown; from: string; received: number }[] };
    expect(listed.v).toBe("2.1");
    expect(listed.invites.map(({ id, sealed, from }) => ({ id, sealed, from }))).toEqual([
      { id: await sha256Url(canonicalJson(first)), sealed: first, from: "sender-a" },
      { id: await sha256Url(canonicalJson(second)), sealed: second, from: "sender-b" },
    ]);
    for (const { received } of listed.invites) { expect(received).toBeGreaterThanOrEqual(before); expect(received).toBeLessThanOrEqual(Date.now()); }
    const deleted = await remove(listed.invites[0]!.id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ v: "2.1" });
    expect(((await (await list()).json()) as { invites: { id: string }[] }).invites.map(({ id }) => id)).toEqual([listed.invites[1]!.id]);
    const missing = await remove(await sha256Url("never held"));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ v: "2.1" });
  });

  it("refuses a wrong owner secret for list and delete", async () => {
    const { post, list, remove } = setup();
    const { id } = (await (await post({ sealed: sealedFor(1), from: "sender-a" }, token)).json()) as { id: string };
    for (const response of [await list("wrong-secret"), await remove(id, "wrong-secret"), await list(token)]) {
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toBe("unauthorized");
    }
    expect(await pendingCount(list)).toBe(1);
  });

  it("posts, lists and deletes through the client functions, which throw RelayRequestError on a refusal", async () => {
    const { fetchFn } = setup();
    const sealed = sealedFor(1);
    const id = await postInvite({ inboxUrl: RELAY, inboxToken: token, sealed, from: "sender-a", fetch: fetchFn });
    expect(id).toBe(await sha256Url(canonicalJson(sealed)));
    const invites = await listInbox({ relayUrl: RELAY, ownerSecret: OWNER_SECRET, fetch: fetchFn });
    expect(invites.map(({ id: held, sealed: body, from }) => ({ id: held, sealed: body, from }))).toEqual([{ id, sealed, from: "sender-a" }]);
    await deleteInvite({ relayUrl: RELAY, ownerSecret: OWNER_SECRET, id, fetch: fetchFn });
    expect(await listInbox({ relayUrl: RELAY, ownerSecret: OWNER_SECRET, fetch: fetchFn })).toEqual([]);
    await expect(listInbox({ relayUrl: RELAY, ownerSecret: "wrong", fetch: fetchFn })).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    await expect(postInvite({ inboxUrl: RELAY, inboxToken: "wrong", sealed, from: "sender-a", fetch: fetchFn })).rejects.toBeInstanceOf(RelayRequestError);
  });
});
