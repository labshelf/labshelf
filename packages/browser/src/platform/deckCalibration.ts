// The poster ruler calibration kept in storage.local on this device (D10); never storage.sync, a calibration belongs to one screen.
import type { CalibrationStore, PosterCalibration } from "@labshelf/core/deckEditor";

const CALIBRATION_KEY = "labshelf.decks.calibration";

/** A stored value as a calibration; undefined unless it has a positive finite pxPerMm and a timestamp. */
function parseCalibration(value: unknown): PosterCalibration | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { pxPerMm, measuredAt } = value as Record<string, unknown>;
  if (typeof pxPerMm !== "number" || !Number.isFinite(pxPerMm) || pxPerMm <= 0 || typeof measuredAt !== "string") return undefined;
  return { pxPerMm, measuredAt };
}

/** A CalibrationStore over a storage.local-like area, under the key the VS Code store uses too. */
export function createStorageCalibrationStore(storage: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }): CalibrationStore {
  return {
    load: async () => parseCalibration((await storage.get(CALIBRATION_KEY))[CALIBRATION_KEY]),
    save: async (calibration) => { await storage.set({ [CALIBRATION_KEY]: { pxPerMm: calibration.pxPerMm, measuredAt: calibration.measuredAt } }); },
  };
}
