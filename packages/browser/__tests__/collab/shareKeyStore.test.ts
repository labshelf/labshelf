// The share keys and relay lists of shared projects survive a round trip through extension storage, apart per library; the display name is global.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { createShareKeyStore, readMemberName, writeMemberName } from "../../src/collab/shareKeyStore";

beforeEach(() => { for (const key of Object.keys(local)) delete local[key]; });

const RELAYS = [{ url: "https://relay.test", relayToken: "token" }, { url: "https://second.test" }];
const A = "a".repeat(32);
const keysOf = (libraryId: string) => createShareKeyStore(async () => libraryId);
const stored = (shareId: string, fill: number, relays: typeof RELAYS | [] = []) => ({ shareId, shareKey: new Uint8Array(16).fill(fill), relays });

describe("shareKeyStore", () => {
  it("returns the key and relays remembered for a share and nothing for another", async () => {
    const keys = keysOf("browser");
    const key = new Uint8Array(16).map((_, i) => i * 7);
    await keys.remember({ shareId: A, shareKey: key, relays: RELAYS });
    await keys.remember(stored("b".repeat(32), 2));
    expect(await keys.invite(A)).toEqual({ shareId: A, shareKey: key, relays: RELAYS });
    expect(await keys.invite("c".repeat(32))).toBeUndefined();
  });

  it("forgets one share and keeps the others", async () => {
    const keys = keysOf("browser");
    await keys.remember(stored(A, 1, RELAYS));
    await keys.remember(stored("b".repeat(32), 2));
    await keys.forget(A);
    expect(await keys.invite(A)).toBeUndefined();
    expect(await keys.invite("b".repeat(32))).toEqual(stored("b".repeat(32), 2));
  });

  it("keeps the same share id apart in two libraries", async () => {
    await keysOf("browser").remember(stored(A, 1, RELAYS));
    await keysOf("bridge:0123456789abcdef").remember(stored(A, 2));
    expect(await keysOf("browser").invite(A)).toEqual(stored(A, 1, RELAYS));
    expect(await keysOf("bridge:0123456789abcdef").invite(A)).toEqual(stored(A, 2));
    expect(await keysOf("picked-id").invite(A)).toBeUndefined();
  });

  it("keeps the display name next to the shares", async () => {
    await keysOf("browser").remember(stored(A, 1, RELAYS));
    await writeMemberName("Ada");
    expect(await readMemberName()).toBe("Ada");
    expect(await keysOf("browser").invite(A)).toEqual(stored(A, 1, RELAYS));
  });

  it("reads nothing from a stored value of the wrong shape and keeps it on the next write", async () => {
    const bad = { [A]: 5, ["b".repeat(32)]: { key: "AQ", relays: [{ url: "http://insecure.test" }] } };
    local["collabShares"] = { libraries: { browser: bad }, displayName: 3 };
    expect(await keysOf("browser").invite(A)).toBeUndefined();
    expect(await keysOf("browser").invite("b".repeat(32))).toBeUndefined();
    expect(await readMemberName()).toBeUndefined();
    await keysOf("browser").remember(stored("c".repeat(32), 3));
    expect((local["collabShares"] as { libraries: { browser: Record<string, unknown> } }).libraries.browser[A]).toBe(5);
  });
});
