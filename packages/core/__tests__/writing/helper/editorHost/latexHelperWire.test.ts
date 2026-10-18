// Pins the wire form of LaTeX helper calls between the web build and its editor page: bytes cross as base64 and survive JSON.
import {
  compileResultFromWire, compileResultToWire, projectFromWire, projectToWire, type HelperCompileResult, type HelperProject,
} from "../../../../src/writing/helper/index.js";

const throughJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("latex helper wire", () => {
  it("carries a project's file bytes through JSON unchanged", () => {
    const project: HelperProject = {
      projectId: "thesis", main: "main.tex", engine: "pdflatex",
      files: [{ path: "main.tex", bytes: new Uint8Array([0, 1, 254, 255]) }, { path: "fig.png", bytes: new Uint8Array() }],
    };
    expect(projectFromWire(throughJson(projectToWire(project)))).toEqual(project);
  });

  it("carries a succeeded result's PDF bytes and a failed result through JSON unchanged", () => {
    const succeeded: HelperCompileResult = { status: "succeeded", problems: [], pdf: new Uint8Array([37, 80, 68, 70]) };
    const failed: HelperCompileResult = { status: "failed", problems: [] };
    expect(compileResultFromWire(throughJson(compileResultToWire(succeeded)))).toEqual(succeeded);
    expect(compileResultFromWire(throughJson(compileResultToWire(failed)))).toEqual(failed);
  });

  it.each([
    ["not an object", 42],
    ["a file without base64", { projectId: "p", main: "m.tex", engine: "pdflatex", files: [{ path: "m.tex", bytes: { 0: 1 } }] }],
    ["an unknown engine", { projectId: "p", main: "m.tex", engine: "troff", files: [] }],
  ])("refuses a malformed project: %s", (_name, wire) => {
    expect(() => projectFromWire(wire)).toThrow(/project/i);
  });

  it("refuses a succeeded result without its PDF", () => {
    expect(() => compileResultFromWire({ status: "succeeded", problems: [] })).toThrow(/result/i);
  });
});
