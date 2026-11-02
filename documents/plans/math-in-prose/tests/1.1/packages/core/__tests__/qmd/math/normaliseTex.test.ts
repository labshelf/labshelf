// Tests normaliseTex (plan math-in-prose, decision D2): the known LaTeX misreads are rewritten before parsing, each rule applied is reported once by name, and any other TeX comes back identical with no rewrites.
import { normaliseTex } from "../../../src/qmd/math/normaliseTex";

// Whitespace around a bare `dx` is not pinned by the spec, only the token sequence is.
function squash(tex: string): string {
  return tex.replace(/\s+/g, "");
}

describe("1.1a euler-e", () => {
  it.each([
    ["e^{-x^2}", "\\exp\\left(-x^2\\right)"],
    ["e^x", "\\exp\\left(x\\right)"],
    ["\\mathrm{e}^{i\\pi}", "\\exp\\left(i\\pi\\right)"],
    ["\\mathrm{e}^{x^{2}}", "\\exp\\left(x^{2}\\right)"],
    ["e^{x^{2}}", "\\exp\\left(x^{2}\\right)"],
    ["2e^{x}", "2\\exp\\left(x\\right)"],
  ])("1.1a rewrites %s to the exp form and reports euler-e", (input, expected) => {
    expect(normaliseTex(input)).toEqual({ tex: expected, rewrites: ["euler-e"] });
  });

  it("1.1a keeps a lone e as a variable", () => {
    expect(normaliseTex("e + 1")).toEqual({ tex: "e + 1", rewrites: [] });
  });

  it("1.1a rewrites every e power and reports euler-e once", () => {
    const out = normaliseTex("e^{x} + e^{y}");
    expect(out.tex).toBe("\\exp\\left(x\\right) + \\exp\\left(y\\right)");
    expect(out.rewrites).toEqual(["euler-e"]);
  });
});

describe("1.1a differential", () => {
  it("1.1a rewrites \\mathrm{d}x inside an integral to \\,dx", () => {
    expect(normaliseTex("\\int_0^1 x^2\\,\\mathrm{d}x")).toEqual({
      tex: "\\int_0^1 x^2\\,dx",
      rewrites: ["differential"],
    });
  });

  it("1.1a rewrites a bare dx at the end of an integral", () => {
    const out = normaliseTex("\\int_0^1 \\frac{\\ln(1+x)}{x} dx");
    expect(squash(out.tex)).toBe(squash("\\int_0^1 \\frac{\\ln(1+x)}{x}\\,dx"));
    expect(out.tex).toContain("\\,dx");
    expect(out.rewrites).toEqual(["differential"]);
  });

  it("1.1a rewrites a bare dx that is followed by =", () => {
    const out = normaliseTex("\\int x dx = \\frac{x^2}{2}");
    expect(squash(out.tex)).toBe(squash("\\int x\\,dx = \\frac{x^2}{2}"));
    expect(out.tex).toContain("\\,dx");
    expect(out.rewrites).toEqual(["differential"]);
  });

  it("1.1a rewrites a bare dx that is followed by \\approx", () => {
    const out = normaliseTex("\\int_0^1 x^2 dx \\approx 0.33");
    expect(squash(out.tex)).toBe(squash("\\int_0^1 x^2\\,dx \\approx 0.33"));
    expect(out.tex).toContain("\\,dx");
    expect(out.rewrites).toEqual(["differential"]);
  });

  it("1.1a rewrites a bare dx that is followed by a closing brace", () => {
    const out = normaliseTex("\\frac{\\int x dx}{2}");
    expect(squash(out.tex)).toBe(squash("\\frac{\\int x\\,dx}{2}"));
    expect(out.tex).toContain("\\,dx");
    expect(out.rewrites).toEqual(["differential"]);
  });

  it("1.1a turns \\, dx into \\,dx", () => {
    expect(normaliseTex("\\int_0^1 x^2\\, dx").tex).toBe("\\int_0^1 x^2\\,dx");
  });

  it("1.1a leaves dx and \\mathrm{d}x alone when there is no \\int", () => {
    expect(normaliseTex("dx + 1")).toEqual({ tex: "dx + 1", rewrites: [] });
    expect(normaliseTex("\\mathrm{d}x")).toEqual({ tex: "\\mathrm{d}x", rewrites: [] });
  });
});

describe("1.1a leibniz", () => {
  it("1.1a rewrites the idea doc row \\frac{dy}{dx} = -ky", () => {
    expect(normaliseTex("\\frac{dy}{dx} = -ky")).toEqual({
      tex: "y'(x) = -ky(x)",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a rewrites every other bare y, with spaces kept", () => {
    expect(normaliseTex("\\frac{dy}{dx} = -k y")).toEqual({
      tex: "y'(x) = -k y(x)",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a rewrites a second derivative to y''(x) and the bare y after it", () => {
    expect(normaliseTex("\\frac{d^2y}{dx^2} + y = 0")).toEqual({
      tex: "y''(x) + y(x) = 0",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a takes the names from the numerator and the denominator", () => {
    expect(normaliseTex("\\frac{dN}{dt} = -kN")).toEqual({
      tex: "N'(t) = -kN(t)",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a does not rewrite the independent variable", () => {
    expect(normaliseTex("\\frac{dy}{dx} = x y")).toEqual({
      tex: "y'(x) = x y(x)",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a does not rewrite a symbol that is already followed by (", () => {
    expect(normaliseTex("\\frac{dy}{dx} = y(x)")).toEqual({
      tex: "y'(x) = y(x)",
      rewrites: ["leibniz"],
    });
  });

  it("1.1a does not rewrite the letter inside \\exp", () => {
    const out = normaliseTex("\\frac{dx}{dt} = \\exp\\left(t\\right) x");
    expect(out.tex).toBe("x'(t) = \\exp\\left(t\\right) x(t)");
    expect(out.rewrites).toEqual(["leibniz"]);
  });
});

describe("1.1a newton-dot", () => {
  it("1.1a rewrites the idea doc row \\dot{x} = -x", () => {
    expect(normaliseTex("\\dot{x} = -x")).toEqual({
      tex: "x'(t) = -x(t)",
      rewrites: ["newton-dot"],
    });
  });

  it("1.1a rewrites \\ddot{x} to x''(t) and the bare x after it", () => {
    expect(normaliseTex("\\ddot{x} = -x")).toEqual({
      tex: "x''(t) = -x(t)",
      rewrites: ["newton-dot"],
    });
  });

  it("1.1a rewrites dots of both orders and reports newton-dot once", () => {
    expect(normaliseTex("\\ddot{x} + \\dot{x} + x = 0")).toEqual({
      tex: "x''(t) + x'(t) + x(t) = 0",
      rewrites: ["newton-dot"],
    });
  });

  it("1.1a does not rewrite a symbol that is already followed by (", () => {
    expect(normaliseTex("\\dot{x} = x(t)")).toEqual({
      tex: "x'(t) = x(t)",
      rewrites: ["newton-dot"],
    });
  });
});

describe("1.1a reporting order", () => {
  it("1.1a lists each rule once, in the order first applied", () => {
    const out = normaliseTex("\\int_0^\\infty e^{-x^2} dx");
    expect(squash(out.tex)).toBe(squash("\\int_0^\\infty \\exp\\left(-x^2\\right)\\,dx"));
    expect(out.rewrites).toEqual(["euler-e", "differential"]);
  });

  it("1.1a reports both rules when a derivative equation contains an e power", () => {
    const out = normaliseTex("\\frac{dy}{dx} = e^{-x}");
    expect(out.tex).toContain("y'(x)");
    expect(out.tex).toContain("\\exp\\left(-x\\right)");
    expect([...out.rewrites].sort()).toEqual(["euler-e", "leibniz"]);
  });
});

describe("1.1b unchanged TeX", () => {
  it.each([
    "\\sum_{k=0}^{t-1}(1-b)b^k",
    "\\int x\\sin(x)\\,dx",
    "\\lim_{n\\to\\infty}(1+1/n)^n",
  ])("1.1b returns %s unchanged with no rewrites", (input) => {
    expect(normaliseTex(input)).toEqual({ tex: input, rewrites: [] });
  });

  it("1.1b returns an empty string unchanged", () => {
    expect(normaliseTex("")).toEqual({ tex: "", rewrites: [] });
  });
});

describe("A1 normaliseTex", () => {
  it.each([
    ["euler-e", "e^{-x^2}", "\\exp\\left(-x^2\\right)"],
    ["differential", "\\int_0^1 x^2\\,\\mathrm{d}x", "\\int_0^1 x^2\\,dx"],
    ["leibniz", "\\frac{dy}{dx} = -ky", "y'(x) = -ky(x)"],
    ["newton-dot", "\\dot{x} = -x", "x'(t) = -x(t)"],
  ])("A1 applies %s and reports it", (rule, input, expected) => {
    expect(normaliseTex(input)).toEqual({ tex: expected, rewrites: [rule] });
  });

  it("A1 leaves other TeX unchanged", () => {
    const input = "\\int_0^1 \\frac{\\ln(1+x)}{x}\\,dx + y'(x) = -k\\, y(x)";
    expect(normaliseTex(input)).toEqual({ tex: input, rewrites: [] });
  });
});
