// Pins the wire form of Typst compiles between the web build and its editor page: the PDF crosses as base64 and survives JSON.
import {
  typstOutcomeFromWire, typstOutcomeToWire, typstRequestFromWire, type TypstHostOutcome, type TypstHostRequest,
} from "../../../../src/writing/helper/index.js";

const throughJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("typst compile wire", () => {
  it("accepts a request with project-relative unsaved sources", () => {
    const request: TypstHostRequest = { projectId: "cv", main: "main.typ", sources: [{ path: "chapters/a.typ", text: "= A" }] };
    expect(typstRequestFromWire(throughJson(request))).toEqual(request);
  });

  it("refuses a request without its main file or with a malformed source", () => {
    expect(() => typstRequestFromWire({ projectId: "cv", sources: [] })).toThrow(/main/);
    expect(() => typstRequestFromWire({ projectId: "cv", main: "main.typ", sources: [{ path: "a.typ" }] })).toThrow(/source/);
  });

  it("carries a succeeded outcome's PDF bytes, problems and cites, and a failed outcome, through JSON unchanged", () => {
    const succeeded: TypstHostOutcome = {
      status: "succeeded", pdf: new Uint8Array([37, 80, 68, 70]),
      problems: [{ severity: "warning", message: "unused", file: "main.typ", line: 3 }],
      cites: [{ key: "vaswani2017", at: { page: 1, x: 10, y: 20 } }],
    };
    const failed: TypstHostOutcome = { status: "failed", problems: [{ severity: "error", message: "unknown variable", file: "main.typ", line: 1 }] };
    expect(typstOutcomeFromWire(throughJson(typstOutcomeToWire(succeeded)))).toEqual(succeeded);
    expect(typstOutcomeFromWire(throughJson(typstOutcomeToWire(failed)))).toEqual(failed);
  });

  it("refuses a succeeded outcome without its PDF", () => {
    expect(() => typstOutcomeFromWire({ status: "succeeded", problems: [], cites: [] })).toThrow(/PDF/);
  });
});
