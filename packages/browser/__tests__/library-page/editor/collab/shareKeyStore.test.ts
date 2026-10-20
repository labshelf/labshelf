// The share keys and relay lists of shared projects survive a round trip through extension storage, apart per library; the display name is global.
const local: Record<string, unknown> = {};
jest.mock("../../../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { loadDisplayName, loadShare, saveDisplayName, saveShare } from "../../../../src/library-page/editor/collab";

beforeEach(() => { for (const key of Object.keys(local)) delete local[key]; });

const RELAYS = [{ url: "https://relay.test", relayToken: "token" }, { url: "https://second.test" }];
const A = "a".repeat(32);

describe("shareKeyStore", () => {
  it("returns the key and relays saved for a share and nothing for another", async () => {
    const key = new Uint8Array(16).map((_, i) => i * 7);
    await saveShare("browser", A, key, RELAYS);
    await saveShare("browser", "b".repeat(32), new Uint8Array(16).fill(2), []);
    expect(await loadShare("browser", A)).toEqual({ shareKey: key, relays: RELAYS });
    expect(await loadShare("browser", "c".repeat(32))).toBeUndefined();
  });

  it("keeps the same share id apart in two libraries", async () => {
    await saveShare("browser", A, new Uint8Array(16).fill(1), RELAYS);
    await saveShare("bridge:0123456789abcdef", A, new Uint8Array(16).fill(2), []);
    expect(await loadShare("browser", A)).toEqual({ shareKey: new Uint8Array(16).fill(1), relays: RELAYS });
    expect(await loadShare("bridge:0123456789abcdef", A)).toEqual({ shareKey: new Uint8Array(16).fill(2), relays: [] });
    expect(await loadShare("picked-id", A)).toBeUndefined();
  });

  it("keeps the display name next to the shares", async () => {
    await saveShare("browser", A, new Uint8Array(16).fill(1), RELAYS);
    await saveDisplayName("Ada");
    expect(await loadDisplayName()).toBe("Ada");
    expect(await loadShare("browser", A)).toEqual({ shareKey: new Uint8Array(16).fill(1), relays: RELAYS });
  });

  it("reads nothing from a stored value of the wrong shape and keeps it on the next write", async () => {
    const bad = { [A]: 5, ["b".repeat(32)]: { key: "AQ", relays: [{ url: "http://insecure.test" }] } };
    local["collabShares"] = { libraries: { browser: bad }, displayName: 3 };
    expect(await loadShare("browser", A)).toBeUndefined();
    expect(await loadShare("browser", "b".repeat(32))).toBeUndefined();
    expect(await loadDisplayName()).toBeUndefined();
    await saveShare("browser", "c".repeat(32), new Uint8Array(16).fill(3), []);
    expect((local["collabShares"] as { libraries: { browser: Record<string, unknown> } }).libraries.browser[A]).toBe(5);
  });
});
