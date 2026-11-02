// Tests the poster calibration store over a storage.local-like area: it saves {pxPerMm, measuredAt} under labshelf.decks.calibration,
// loads it back, and ignores a stored value whose pxPerMm is not a positive finite number.
import { createStorageCalibrationStore } from "../../src/platform/deckCalibration";

const KEY = "labshelf.decks.calibration";

function fakeStorage(initial: Record<string, unknown> = {}) {
  const items: Record<string, unknown> = { ...initial };
  return {
    items,
    get: jest.fn(async (key: string) => (key in items ? { [key]: items[key] } : {})),
    set: jest.fn(async (next: Record<string, unknown>) => { Object.assign(items, next); }),
  };
}

describe("storage calibration store", () => {
  it("9.1d saves the calibration under labshelf.decks.calibration", async () => {
    const storage = fakeStorage();
    const calibration = { pxPerMm: 3.78, measuredAt: "2026-11-02T10:00:00.000Z" };
    await createStorageCalibrationStore(storage).save(calibration);
    expect(storage.set).toHaveBeenCalledWith({ [KEY]: calibration });
    expect(storage.items[KEY]).toEqual(calibration);
  });

  it("9.1d loads the saved calibration back", async () => {
    const storage = fakeStorage();
    const calibration = { pxPerMm: 4.5, measuredAt: "2026-11-02T11:00:00.000Z" };
    await createStorageCalibrationStore(storage).save(calibration);
    expect(await createStorageCalibrationStore(storage).load()).toEqual(calibration);
  });

  it("9.1d loads nothing when no calibration is stored", async () => {
    expect(await createStorageCalibrationStore(fakeStorage()).load()).toBeUndefined();
  });

  it("9.1d ignores a stored value without a positive finite pxPerMm", async () => {
    const at = "2026-11-02T10:00:00.000Z";
    for (const bad of [null, "4", 4, { pxPerMm: 0, measuredAt: at }, { pxPerMm: -2, measuredAt: at }, { pxPerMm: Number.NaN, measuredAt: at }, { pxPerMm: Number.POSITIVE_INFINITY, measuredAt: at }, { pxPerMm: "3.7", measuredAt: at }, { measuredAt: at }]) {
      const store = createStorageCalibrationStore(fakeStorage({ [KEY]: bad }));
      expect([bad, await store.load()]).toEqual([bad, undefined]);
    }
  });
});
