/** Verifies the blank templates of new projects. */
import { blankTemplate } from "../../src/templates/index";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("blankTemplate", () => {
  it("describes a blank template by format: id, main file and no engine", () => {
    expect(blankTemplate("latex", "T").template).toEqual({ id: "blank-latex", format: "latex", main: "main.tex" });
    expect(blankTemplate("typst", "T").template).toEqual({ id: "blank-typst", format: "typst", main: "main.typ" });
  });

  it("holds the main file as the only file", () => {
    expect(blankTemplate("latex", "T").files.map((file) => file.path)).toEqual(["main.tex"]);
    expect(blankTemplate("typst", "T").files.map((file) => file.path)).toEqual(["main.typ"]);
  });

  it("escapes LaTeX special characters in the title", () => {
    const main = text(blankTemplate("latex", "A&B 100% x_y #1 {z} \\ ~ ^ $").files[0]!.bytes);
    expect(main).toContain(
      "\\title{A\\&B 100\\% x\\_y \\#1 \\{z\\} \\textbackslash{} \\textasciitilde{} \\textasciicircum{} \\$}",
    );
    expect(main).toContain("\\documentclass{article}");
  });

  it("escapes quotes and backslashes in the Typst title string", () => {
    const main = text(blankTemplate("typst", 'Say "hi" \\ there').files[0]!.bytes);
    expect(main).toContain('#let title = "Say \\"hi\\" \\\\ there"');
  });
});
