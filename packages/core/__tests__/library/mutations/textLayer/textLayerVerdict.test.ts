import {
  shouldWriteVerdict, deriveVerdictForDetection, deriveVerdictForError, deriveVerdictForOutcome, type TextLayerDetails,
} from "@labshelf/core";

const NOW = "2026-01-01T00:00:00.000Z";
const now = () => NOW;

describe("verdictForOutcome", () => {
  it("maps each OCR outcome to the stored verdict", () => {
    expect(deriveVerdictForOutcome({ status: "added", bytes: new Uint8Array(), pagesAdded: 3, pagesFailed: 0 }, now))
      .toEqual({ state: "ocr", ocrPages: 3, checkedAt: NOW });
    expect(deriveVerdictForOutcome({ status: "added", bytes: new Uint8Array(), pagesAdded: 3, pagesFailed: 2 }, now))
      .toEqual({ state: "ocr", ocrPages: 3, failedPages: 2, checkedAt: NOW });
    expect(deriveVerdictForOutcome({ status: "not-needed", layer: "native" }, now)).toEqual({ state: "native", checkedAt: NOW });
    expect(deriveVerdictForOutcome({ status: "cancelled" }, now)).toEqual({ state: "missing", reason: "OCR was cancelled", checkedAt: NOW });
    expect(deriveVerdictForOutcome({ status: "skipped", code: "ocr-disabled", reason: "OCR is off" }, now)).toEqual({ state: "missing", reason: "OCR is off", checkedAt: NOW });
    expect(deriveVerdictForOutcome({ status: "unavailable", reason: "no worker" }, now)).toEqual({ state: "failed", reason: "no worker", checkedAt: NOW });
  });
});

describe("verdictForDetection / verdictForError", () => {
  it("maps a check without OCR to the stored verdict", () => {
    expect(deriveVerdictForDetection({ status: "native" }, now)).toEqual({ state: "native", checkedAt: NOW });
    expect(deriveVerdictForDetection({ status: "ocr" }, now)).toEqual({ state: "ocr", checkedAt: NOW });
    expect(deriveVerdictForDetection({ status: "missing", textlessPages: 4, totalPages: 4 }, now)).toEqual({ state: "missing", checkedAt: NOW });
    expect(deriveVerdictForDetection({ status: "unavailable", reason: "broken" }, now)).toEqual({ state: "failed", reason: "broken", checkedAt: NOW });
    expect(deriveVerdictForError(new Error("boom"), now)).toEqual({ state: "failed", reason: "boom", checkedAt: NOW });
  });

  it("stamps the wall clock when no clock is injected", () => {
    expect(Date.parse(deriveVerdictForDetection({ status: "native" }).checkedAt)).not.toBeNaN();
  });
});

describe("shouldRecordVerdict", () => {
  const ocr: TextLayerDetails = { state: "ocr", ocrPages: 5, checkedAt: "2025-01-01T00:00:00.000Z" };

  it("records a first or a different verdict", () => {
    expect(shouldWriteVerdict(undefined, { state: "native", checkedAt: NOW })).toBe(true);
    expect(shouldWriteVerdict({ state: "missing", checkedAt: NOW }, { state: "native", checkedAt: NOW })).toBe(true);
    expect(shouldWriteVerdict({ state: "failed", reason: "a", checkedAt: NOW }, { state: "failed", reason: "b", checkedAt: NOW })).toBe(true);
  });

  it("skips a verdict that differs only in its timestamp", () => {
    expect(shouldWriteVerdict({ state: "native", checkedAt: "2020-01-01T00:00:00.000Z" }, { state: "native", checkedAt: NOW })).toBe(false);
  });

  it("keeps the OCR detail when a re-check finds text without a page count", () => {
    expect(shouldWriteVerdict(ocr, { state: "native", checkedAt: NOW })).toBe(false);
    expect(shouldWriteVerdict(ocr, { state: "ocr", checkedAt: NOW })).toBe(false);
    expect(shouldWriteVerdict(ocr, { state: "ocr", ocrPages: 6, checkedAt: NOW })).toBe(true);
    expect(shouldWriteVerdict(ocr, { state: "missing", checkedAt: NOW })).toBe(true);
  });
});
