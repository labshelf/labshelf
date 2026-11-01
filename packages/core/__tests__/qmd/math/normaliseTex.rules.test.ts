// Tests the normaliseTex rules that spec 1.5 adds from the reader measurement: the derivative operator, the implicit product before a parenthesis, and a lone \mathrm{e}.
import { normaliseTex } from "../../../src/qmd/math/normaliseTex";

describe("1.5a derivative-operator", () => {
  it("1.5a rewrites \\frac{\\mathrm{d}}{\\mathrm{d}x} to \\frac{d}{dx} and reports derivative-operator", () => {
    expect(normaliseTex("\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(x^2\\right)")).toEqual({
      tex: "\\frac{d}{dx}\\left(x^2\\right)",
      rewrites: ["derivative-operator"],
    });
  });

  it("1.5a reports an operator already written \\frac{d}{dt} and leaves it as it is", () => {
    expect(normaliseTex("\\frac{d}{dt}\\left(t^3\\right)")).toEqual({
      tex: "\\frac{d}{dt}\\left(t^3\\right)",
      rewrites: ["derivative-operator"],
    });
  });

  it("1.5a keeps Leibniz \\frac{dy}{dx} as leibniz, not derivative-operator", () => {
    expect(normaliseTex("\\frac{dy}{dx} = -ky")).toEqual({ tex: "y'(x) = -ky(x)", rewrites: ["leibniz"] });
  });
});

describe("1.5a implicit-product", () => {
  it("1.5a puts \\, before \\left( after a single letter", () => {
    const out = normaliseTex("-k\\left(C\\mathrm{e}^{-kx}\\right)");
    expect(out.tex).toBe("-k\\,\\left(C\\exp\\left(-kx\\right)\\right)");
    expect(out.rewrites).toEqual(["euler-e", "implicit-product"]);
  });

  it.each([
    ["k(x+1)", "k\\,(x+1)"],
    ["k (x+1)", "k \\,(x+1)"],
    ["a\\left(b+c\\right) = ab + ac", "a\\,\\left(b+c\\right) = ab + ac"],
  ])("1.5a rewrites %s to a product", (input, expected) => {
    expect(normaliseTex(input)).toEqual({ tex: expected, rewrites: ["implicit-product"] });
  });

  it.each([
    "f(x)",
    "g(x, y) + y(t)",
    "f\\left(x\\right)",
    "\\sin(x)",
    "\\ln(1+x)",
    "\\exp\\left(x\\right)",
    "f'(x+1)",
    "ab(x+1)",
  ])("1.5a keeps %s unchanged", (input) => {
    expect(normaliseTex(input)).toEqual({ tex: input, rewrites: [] });
  });

  it("1.5a keeps the calls that leibniz and newton-dot write", () => {
    expect(normaliseTex("\\frac{dy}{dx} = -ky").rewrites).not.toContain("implicit-product");
    expect(normaliseTex("\\dot{x} = -x")).toEqual({ tex: "x'(t) = -x(t)", rewrites: ["newton-dot"] });
  });
});

describe("1.5a euler-e for a lone \\mathrm{e}", () => {
  it("1.5a ends the limit step with \\exp\\left(1\\right)", () => {
    const out = normaliseTex("\\lim_{n\\to\\infty}(1+1/n)^n = \\mathrm{e}");
    expect(out.tex.endsWith("\\exp\\left(1\\right)")).toBe(true);
    expect(out.rewrites).toContain("euler-e");
  });

  it("1.5a still keeps a bare e as a variable", () => {
    expect(normaliseTex("e + 1")).toEqual({ tex: "e + 1", rewrites: [] });
  });
});
