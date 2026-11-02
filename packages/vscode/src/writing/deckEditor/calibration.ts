// The poster calibration kept in the user's globalState on this device; the key is never registered for settings sync.
import type * as vscode from "vscode";

import { parseWireCalibration, type CalibrationStore } from "./deckMessages.js";

const CALIBRATION_KEY = "labshelf.decks.calibration";

/** A CalibrationStore over the memento; load ignores a stored value that is not a positive finite pxPerMm with a timestamp. */
export function createGlobalCalibrationStore(memento: vscode.Memento): CalibrationStore {
  return {
    load: async () => parseWireCalibration(memento.get<unknown>(CALIBRATION_KEY)) ?? undefined,
    save: async (calibration) => { await memento.update(CALIBRATION_KEY, { pxPerMm: calibration.pxPerMm, measuredAt: calibration.measuredAt }); },
  };
}
