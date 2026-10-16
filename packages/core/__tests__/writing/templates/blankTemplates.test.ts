/** Verifies the main file templates of new projects. */
import { blankTemplate } from "../../../src/writing/templates/index";

describe("blankTemplate", () => {
  it("names the main file by format", () => {
    expect(blankTemplate("latex", "T").main).toBe("main.tex");
    expect(blankTemplate("typst", "T").main).toBe("main.typ");
  });

  it("escapes LaTeX special characters in the title", () => {
    const { text } = blankTemplate("latex", "A&B 100% x_y #1 {z} \\ ~ ^ $");
    expect(text).toContain(
      "\\title{A\\&B 100\\% x\\_y \\#1 \\{z\\} \\textbackslash{} \\textasciitilde{} \\textasciicircum{} \\$}",
    );
    expect(text).toContain("\\documentclass{article}");
  });

  it("escapes quotes and backslashes in the Typst title string", () => {
    const { text } = blankTemplate("typst", 'Say "hi" \\ there');
    expect(text).toContain('#let title = "Say \\"hi\\" \\\\ there"');
  });
});
