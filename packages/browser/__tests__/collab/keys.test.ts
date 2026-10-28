// The share keys and relay lists of shared projects survive a round trip through extension storage, apart per library; the display name is global; keys saved before shares were kept per library move under their library.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { createShareKeyStore, readMemberName, writeMemberName } from "../../src/collab";
import { parseStoredShare, readLibraryShares, readStoredShares, updateUnscopedShares } from "../../src/collab/keys";

// The share keys and relay lists of shared projects survive a round trip through extension storage, apart per library; the display name is global.
describe("keys", () => {
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
});

// Pins how share keys saved before shares were kept per library move under the library whose projects hold them.
describe("keysUnscoped", () => {
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  const entry = { key: "AQID", relays: [{ url: "https://relay.test" }] };
  /** The library's entry for the share as stored, read past the key store, which would run the migration itself. */
  const loadShare = async (libraryId: string, shareId: string) => parseStoredShare(readLibraryShares(await readStoredShares(), libraryId)[shareId]);
  const stored = (): { shares?: Record<string, unknown>; libraries?: Record<string, Record<string, unknown>>; displayName?: string } =>
    local["collabShares"] as never;

  beforeEach(() => {
    for (const key of Object.keys(local)) delete local[key];
    local["collabShares"] = { shares: { [A]: entry, [B]: entry, ["c".repeat(32)]: 7 }, displayName: "Ada" };
  });

  describe("updateUnscopedShares", () => {
    it("moves the entries of this library's projects under its id and leaves the rest", async () => {
      await updateUnscopedShares("browser", [A]);
      expect(await loadShare("browser", A)).toEqual(entry);
      expect(await loadShare("browser", B)).toBeUndefined();
      expect(stored().shares).toEqual({ [B]: entry, ["c".repeat(32)]: 7 });
      expect(stored().displayName).toBe("Ada");
    });

    it("gives a later library the entries the first one did not hold", async () => {
      await updateUnscopedShares("browser", [A]);
      await updateUnscopedShares("bridge:0123456789abcdef", [A, B]);
      expect(await loadShare("bridge:0123456789abcdef", B)).toBeDefined();
      expect(await loadShare("bridge:0123456789abcdef", A)).toBeUndefined();
      expect(await loadShare("browser", A)).toBeDefined();
    });

    it("changes nothing the second time", async () => {
      await updateUnscopedShares("browser", [A]);
      const after = JSON.stringify(local);
      await updateUnscopedShares("browser", [A]);
      expect(JSON.stringify(local)).toBe(after);
    });

    it("leaves a malformed entry in place even when a project holds its share id", async () => {
      await updateUnscopedShares("browser", ["c".repeat(32)]);
      expect(stored().shares?.["c".repeat(32)]).toBe(7);
      expect(stored().libraries?.["browser"]?.["c".repeat(32)]).toBeUndefined();
    });

    it("keeps a key the library already holds over an unscoped one", async () => {
      local["collabShares"] = { shares: { [A]: entry }, libraries: { browser: { [A]: { key: "BA", relays: [] } } } };
      await updateUnscopedShares("browser", [A]);
      expect(await loadShare("browser", A)).toEqual({ key: "BA", relays: [] });
    });
  });
});
