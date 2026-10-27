/** Verifies latexmk's biber arguments are split into the project root, biber's options and the control file. */
import { parseBiberArgs } from "../../../src/latex/biber/index";

const BCF = "/Users/x/Library/Application Support/LabShelf Helper/projects/p/build/main.tex/main.bcf";

describe("parseBiberArgs", () => {
  it("keeps a control file path with spaces whole and adds .bcf when latexmk leaves it out", () => {
    expect(parseBiberArgs(["--root", "/Users/x/My Project", BCF])).toEqual({ root: "/Users/x/My Project", options: [], controlFile: BCF });
    expect(parseBiberArgs(["--root", "/r", BCF.slice(0, -4)]).controlFile).toBe(BCF);
  });

  it("passes latexmk's options on in order", () => {
    expect(parseBiberArgs(["--root", "/r", "--quiet", "--validate-datamodel", "main"])).toEqual({ root: "/r", options: ["--quiet", "--validate-datamodel"], controlFile: "main.bcf" });
  });

  it("refuses arguments without a root or a control file", () => {
    expect(() => parseBiberArgs(["main.bcf"])).toThrow(/--root/);
    expect(() => parseBiberArgs(["--root", "/r"])).toThrow(/control file/);
    expect(() => parseBiberArgs(["--root", "/r", "--quiet"])).toThrow(/control file/);
  });
});
