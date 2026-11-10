// Pins the Typst compiler's view of the input map, and the clear error for a package import the browser cannot serve.
import { createInputFileAccess, deriveTypstTarget, findPackageImports, toProjectPath, type TypstInputs } from "../../../src/open/runtimes/typstInputs";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("createInputFileAccess", () => {
  it("serves project files under the root and reports folders and missing paths", () => {
    let inputs: TypstInputs = { files: new Map([["main.typ", bytes("= Hi")], ["parts/a.typ", bytes("A")]]), generation: 1 };
    const access = createInputFileAccess(() => inputs);
    expect(access.readAll("/project/main.typ")).toEqual(bytes("= Hi"));
    expect(access.isFile("/project/parts/a.typ")).toBe(true);
    expect(access.isFile("/project/parts")).toBe(false);
    expect(access.isFile("/project/missing.typ")).toBeUndefined();
    expect(access.readAll("/elsewhere/main.typ")).toBeUndefined();
    expect(access.getMTime("/project/missing.typ")).toBeUndefined();
    const before = access.getMTime("/project/main.typ")!.getTime();
    inputs = { files: inputs.files, generation: 2 };
    expect(access.getMTime("/project/main.typ")!.getTime()).toBeGreaterThan(before);
  });

  it("maps project paths to compiler paths and back", () => {
    const target = deriveTypstTarget("parts/main.typ");
    expect(target.main.startsWith(`${target.root}/`)).toBe(true);
    expect(toProjectPath(target.main)).toBe("parts/main.typ");
  });
});

describe("findPackageImports", () => {
  it("names each package a .typ file imports, at its line", () => {
    const files = new Map([
      ["main.typ", bytes('= Title\n#import "@preview/cetz:0.3.1": canvas\n// #import "@preview/old:1.0.0"\n#import "local.typ"')],
      ["notes.txt", bytes('"@preview/cetz:0.3.1"')],
    ]);
    expect(findPackageImports(files)).toEqual([
      { severity: "error", message: "Typst packages are not available in the browser yet: @preview/cetz:0.3.1", file: "main.typ", line: 2 },
    ]);
  });
});
