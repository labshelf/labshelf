/** Verifies the main file templates of new projects. */
import { projectTemplate } from "../../../src/writing/project/index";

describe("projectTemplate", () => {
  it("names the main file by format", () => {
    expect(projectTemplate("latex", "T").main).toBe("main.tex");
    expect(projectTemplate("typst", "T").main).toBe("main.typ");
  });

  it("escapes LaTeX special characters in the title", () => {
    const { text } = projectTemplate("latex", "A&B 100% x_y #1 {z} \\ ~ ^ $");
    expect(text).toContain(
      "\\title{A\\&B 100\\% x\\_y \\#1 \\{z\\} \\textbackslash{} \\textasciitilde{} \\textasciicircum{} \\$}",
    );
    expect(text).toContain("\\documentclass{article}");
  });

  it("escapes quotes and backslashes in the Typst title string", () => {
    const { text } = projectTemplate("typst", 'Say "hi" \\ there');
    expect(text).toContain('#let title = "Say \\"hi\\" \\\\ there"');
  });
});
