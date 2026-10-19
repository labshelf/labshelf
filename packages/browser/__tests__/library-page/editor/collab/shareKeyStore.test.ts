// The share keys, relay lists and display name of shared projects survive a round trip through extension storage.
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

describe("shareKeyStore", () => {
  it("returns the key and relays saved for a share and nothing for another", async () => {
    const key = new Uint8Array(16).map((_, i) => i * 7);
    await saveShare("a".repeat(32), key, RELAYS);
    await saveShare("b".repeat(32), new Uint8Array(16).fill(2), []);
    expect(await loadShare("a".repeat(32))).toEqual({ shareKey: key, relays: RELAYS });
    expect(await loadShare("c".repeat(32))).toBeUndefined();
  });

  it("keeps the display name next to the shares", async () => {
    await saveShare("a".repeat(32), new Uint8Array(16).fill(1), RELAYS);
    await saveDisplayName("Ada");
    expect(await loadDisplayName()).toBe("Ada");
    expect(await loadShare("a".repeat(32))).toEqual({ shareKey: new Uint8Array(16).fill(1), relays: RELAYS });
  });

  it("reads nothing from a stored value of the wrong shape", async () => {
    local["collabShares"] = { shares: { ["a".repeat(32)]: 5, ["b".repeat(32)]: { key: "AQ", relays: [{ url: "http://insecure.test" }] } }, displayName: 3 };
    expect(await loadShare("a".repeat(32))).toBeUndefined();
    expect(await loadShare("b".repeat(32))).toBeUndefined();
    expect(await loadDisplayName()).toBeUndefined();
  });
});
