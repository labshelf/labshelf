// Pins how share keys saved before shares were kept per library move under the library whose projects hold them.
const local: Record<string, unknown> = {};
jest.mock("../../src/platform", () => ({
  bx: { storage: { local: {
    get: async (key: string) => (key in local ? { [key]: JSON.parse(JSON.stringify(local[key])) } : {}),
    set: async (items: Record<string, unknown>) => { Object.assign(local, JSON.parse(JSON.stringify(items))); },
  } } },
}));

import { readLibraryShares, readStoredShares, parseStoredShare } from "../../src/collab/storedShareKeys";
import { updateUnscopedShares } from "../../src/collab/updateUnscopedShares";

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
