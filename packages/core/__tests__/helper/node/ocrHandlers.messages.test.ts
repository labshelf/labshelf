// Pins the helper's OCR messages: their constants and the parser's accepting and rejecting of ocr, cancelOcr, installPix2tex, ocrResult and ocrFailed.
import { PROTOCOL_VERSION, MAX_OCR_PNG_BYTES, OCR_CAPABILITY, OCR_FAILURES } from "../../../src/helper/helperMessages.js";
import { parseHelperMessage } from "../../../src/helper/parseHelperMessage.js";
import { HELPER_CAPABILITIES } from "../../../src/helper/node/helperHandlers.js";
import { ENV, TEX } from "./ocrHandlersHarness.js";

const parsed = (raw: unknown, direction: "toHelper" | "toPage") => parseHelperMessage(raw, direction);
const rejection = (raw: unknown, direction: "toHelper" | "toPage") => {
  const result = parseHelperMessage(raw, direction);
  return result.ok ? undefined : result.code;
};


describe("A9 the OCR message constants", () => {
  it("A9 keeps the protocol version at 11, as helper#version says features are capabilities", () => {
    expect(PROTOCOL_VERSION).toBe(11);
  });

  it("A9 names the capability ocr", () => {
    expect(OCR_CAPABILITY).toBe("ocr");
  });

  it("A9 lists the OCR failures missing, limit and failed", () => {
    expect([...OCR_FAILURES]).toEqual(["missing", "limit", "failed"]);
  });

  it("A9 sets MAX_OCR_PNG_BYTES to 4 MiB", () => {
    expect(MAX_OCR_PNG_BYTES).toBe(4 * 1024 * 1024);
  });

  it("A9 announces ocr next to printPdf in HELPER_CAPABILITIES", () => {
    expect(HELPER_CAPABILITIES).toContain("ocr");
    expect(HELPER_CAPABILITIES).toContain("printPdf");
  });
});

describe("A9 OCR messages at the parser", () => {
  it("A9 accepts an ocr with its byte count sent to the helper", () => {
    const message = { ...ENV("o1"), type: "ocr", bytes: 8 };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocr whose bytes is not a non-negative integer", () => {
    expect(rejection({ ...ENV("o1"), type: "ocr" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: "8" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: -1 }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: 1.5 }, "toHelper")).toBe("invalid-field");
  });

  it("A9 rejects an ocr sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocr", bytes: 8 }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts a cancelOcr naming a request id", () => {
    const message = { ...ENV("c1"), type: "cancelOcr", requestId: "o1" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects a cancelOcr without a string requestId", () => {
    expect(rejection({ ...ENV("c1"), type: "cancelOcr" }, "toHelper")).toBe("invalid-field");
    expect(rejection({ ...ENV("c1"), type: "cancelOcr", requestId: 7 }, "toHelper")).toBe("invalid-field");
  });

  it("A9 rejects a cancelOcr sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("c1"), type: "cancelOcr", requestId: "o1" }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts an installPix2tex sent to the helper", () => {
    const message = { ...ENV("i1"), type: "installPix2tex" };
    expect(parsed(message, "toHelper")).toEqual({ ok: true, message });
  });

  it("A9 rejects an installPix2tex sent to the page as unknown-type", () => {
    expect(rejection({ ...ENV("i1"), type: "installPix2tex" }, "toPage")).toBe("unknown-type");
  });

  it("A9 accepts an ocrResult with its latex sent to the page", () => {
    const message = { ...ENV("o1"), type: "ocrResult", latex: "x^{2}+1" };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocrResult without a string latex", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrResult" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrResult", latex: 3 }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrResult sent to the helper as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrResult", latex: "x" }, "toHelper")).toBe("unknown-type");
  });

  it.each(["missing", "limit", "failed"])("A9 accepts an ocrFailed with reason %s", (reason) => {
    const message = { ...ENV("o1"), type: "ocrFailed", reason, message: "No pix2tex." };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });

  it("A9 rejects an ocrFailed with a reason outside missing, limit and failed", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "unsupported", message: "x" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "cancelled", message: "x" }, "toPage")).toBe("invalid-field");
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", message: "x" }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrFailed without a string message", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "failed" }, "toPage")).toBe("invalid-field");
  });

  it("A9 rejects an ocrFailed sent to the helper as unknown-type", () => {
    expect(rejection({ ...ENV("o1"), type: "ocrFailed", reason: "failed", message: "x" }, "toHelper")).toBe("unknown-type");
  });

  it("A9 keeps ocr in a ready's capabilities", () => {
    const message = {
      ...ENV("r1"), type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "1.0.0", host: "helper", tex: TEX, capabilities: ["printPdf", "ocr"],
    };
    expect(parsed(message, "toPage")).toEqual({ ok: true, message });
  });
});
