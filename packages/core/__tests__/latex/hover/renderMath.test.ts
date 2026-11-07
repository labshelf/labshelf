/** Verifies math rendering to SVG with project macros, and the image it becomes for a hover. */
import { createMathImageUri, renderMathSvg } from "../../../src/latex/hover/index";

function decode(uri: string): string {
  return Buffer.from(uri.replace("data:image/svg+xml;base64,", ""), "base64").toString("utf8");
}

describe("renderMathSvg", () => {
  it("renders inline and display TeX to SVG", () => {
    expect(renderMathSvg("\\alpha^2", false)).toMatch(/^<svg[^>]*>/);
    expect(renderMathSvg("\\begin{align*} a &= b \\\\ c &= d \\end{align*}", true)).toMatch(/^<svg/);
  });

  it("expands the project's macros, with arguments and defaults", () => {
    const macros = { R: "\\mathbb{R}", norm: ["\\lVert #1 \\rVert", 1] as [string, number] };
    expect(() => renderMathSvg("\\norm{x} \\in \\R", false, macros)).not.toThrow();
  });

  it("throws the TeX error for input that does not parse", () => {
    expect(() => renderMathSvg("{x", false)).toThrow(/close brace/i);
    expect(() => renderMathSvg("\\frac{a}", false)).toThrow();
  });

  it("gives an accented letter in text the width of its base letter", () => {
    const offsets = (svg: string): number[] => [...svg.matchAll(/data-c="72"[^>]*translate\((\d+)/g)].map((match) => Number(match[1]));
    // `r` follows the vowel in both; the accented one must sit where the plain one does.
    expect(offsets(renderMathSvg("\\text{contrário}", true))).toEqual(offsets(renderMathSvg("\\text{contrario}", true)));
  });

  it("renders the same labelled equation again", () => {
    const tex = "\\begin{equation}\\label{eq:m} x \\end{equation}";
    expect(renderMathSvg(tex, true)).toContain("<svg");
    expect(renderMathSvg(tex, true)).toContain("<svg");
  });

  it("throws a parse error as an Error with TeX's message", () => {
    expect(() => renderMathSvg("\\frac{a}", false)).toThrow(expect.objectContaining({ message: expect.any(String) }));
    try { renderMathSvg("\\frac{a}", false); } catch (error) { expect(error).toBeInstanceOf(Error); }
  });

  it("renders an unknown command as its name rather than failing", () => {
    expect(renderMathSvg("\\fromSty x", false)).toContain('fill="red"');
  });
});

describe("createMathImageUri", () => {
  it("fixes the colour and converts ex sizes to pixels", () => {
    const svg = decode(createMathImageUri(renderMathSvg("\\fromSty x", false), { text: "#cccccc", error: "#f85149" }));
    expect(svg).not.toMatch(/currentColor|"red"/);
    expect(svg).toContain('fill="#cccccc"');
    expect(svg).toContain('fill="#f85149"');
    expect(svg).toMatch(/width="[\d.]+px"/);
    expect(svg).not.toMatch(/="[\d.]+ex"/);
  });
});
