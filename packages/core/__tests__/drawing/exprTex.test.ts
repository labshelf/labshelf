import { exprTex, parseExpr } from "../../src/drawing/index";

const tex = (text: string, vars = ["x"], params: string[] = []): string => {
  const parsed = parseExpr(text, { vars, params });
  if (!parsed.ok) throw new Error(parsed.error);
  return exprTex(parsed.ast);
};

describe("exprTex", () => {
  it("writes functions, products and fractions", () => {
    expect(tex("sin(a*x)", ["x"], ["a"])).toBe("\\sin\\left(a x\\right)");
    expect(tex("x^2/4")).toBe("\\frac{x^{2}}{4}");
    expect(tex("sin(a*sqrt(x^2+y^2))", ["x", "y"], ["a"])).toBe("\\sin\\left(a\\sqrt{x^{2} + y^{2}}\\right)");
    expect(tex("0.25*x")).toBe("0.25x");
    expect(tex("(x-1)*(x+1)")).toBe("\\left(x - 1\\right)\\left(x + 1\\right)");
  });
});
