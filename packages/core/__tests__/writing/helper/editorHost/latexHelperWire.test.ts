// Pins the wire form of LaTeX helper calls between the web build and its editor page: bytes cross as base64 and survive JSON.
import {
  compileResultFromWire, projectToWire, type EditorHostCompileResult, type EditorHostProject,
} from "../../../../src/writing/helper/editorHost/index.js";

const throughJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("latex helper wire", () => {
  it("encodes a project's file bytes as base64", () => {
    const project: EditorHostProject = {
      projectId: "thesis", main: "main.tex", engine: "pdflatex",
      files: [{ path: "main.tex", bytes: new Uint8Array([104, 105]) }, { path: "fig.png", bytes: new Uint8Array() }],
    };
    expect(throughJson(projectToWire(project))).toEqual({
      projectId: "thesis", main: "main.tex", engine: "pdflatex",
      files: [{ path: "main.tex", base64: "aGk=" }, { path: "fig.png", base64: "" }],
    });
  });

  it("decodes a succeeded result's PDF bytes and a failed result", () => {
    const succeeded: EditorHostCompileResult = { status: "succeeded", problems: [], pdf: new Uint8Array([37, 80, 68, 70]) };
    expect(compileResultFromWire({ status: "succeeded", problems: [], pdfBase64: "JVBERg==" })).toEqual(succeeded);
    expect(compileResultFromWire({ status: "failed", problems: [] })).toEqual({ status: "failed", problems: [] });
  });

  it("refuses a succeeded result without its PDF", () => {
    expect(() => compileResultFromWire({ status: "succeeded", problems: [] })).toThrow(/result/i);
  });

  it("refuses an unknown status", () => {
    expect(() => compileResultFromWire({ status: "exploded", problems: [] })).toThrow(/status/i);
  });
});
