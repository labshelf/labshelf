// Verifies that matchEquation picks the source equation a box shows: by its (N) number, else by symbol similarity (D7).
import { matchEquation } from "../../src/equations/match";

interface SourceEquation {
  env: string;
  body: string;
  latex: string;
  labels: string[];
  numbers: string[];
  offset: number;
}

let offset = 0;
const eq = (body: string, numbers: string[] = [], env = "equation"): SourceEquation => {
  offset += 100;
  return { env, body, latex: `\\begin{${env}}${body}\\end{${env}}`, labels: [], numbers, offset };
};

const quadratic = (n: string[] = []): SourceEquation => eq("\\alpha x^2 + \\beta x + \\gamma = 0", n);
const diffusion = (n: string[] = []): SourceEquation => eq("\\frac{\\partial u}{\\partial t} = \\alpha \\nabla^2 u", n);
const energy = (n: string[] = []): SourceEquation => eq("E = m c^2 + \\sum_{i=1}^{N} \\lambda_i", n);

describe("matchEquation by number", () => {
  it("1.3a picks the equation numbered 4 when the box text ends in (4)", () => {
    const equations = [quadratic(["3"]), diffusion(["4"]), energy(["5"])];
    const match = matchEquation("∂ u ∂ t = α ∇ 2 u (4)", equations);
    expect(match?.by).toBe("number");
    expect(match?.equation).toBe(equations[1]);
  });

  it("1.3a picks the numbered equation even when its symbols are garbled", () => {
    const equations = [quadratic(["3"]), diffusion(["4"]), energy(["5"])];
    const match = matchEquation("� ˆ ∑ q 7 ≈ ¯ ⊗ (4)", equations);
    expect(match?.by).toBe("number");
    expect(match?.equation).toBe(equations[1]);
  });

  it("1.3a lets the number win over a better text match on another equation", () => {
    const equations = [quadratic(["1"]), diffusion(["2"])];
    const match = matchEquation("α x 2 + β x + γ = 0 (2)", equations);
    expect(match?.by).toBe("number");
    expect(match?.equation).toBe(equations[1]);
  });

  it.each([
    ["3a", "( 3a )"],
    ["2.3", "(2.3)"],
    ["A.1", "(A.1)"],
    ["12", "(  12 )"],
  ])("1.3a reads the number %s from %s", (number, token) => {
    const equations = [quadratic(["1"]), diffusion([number]), energy(["99"])];
    const match = matchEquation(`ψ ̃ ∮ ≈ ${token}`, equations);
    expect(match?.by).toBe("number");
    expect(match?.equation).toBe(equations[1]);
  });

  it("1.3a finds the number among several an equation carries", () => {
    const equations = [quadratic(["1"]), diffusion(["2", "3"]), energy(["4"])];
    const match = matchEquation("∂ u ∂ t (3)", equations);
    expect(match?.by).toBe("number");
    expect(match?.equation).toBe(equations[1]);
  });

  it("A4 does not let a number win when two equations carry it", () => {
    const equations = [quadratic(["2"]), diffusion(["2"]), energy(["3"])];
    const match = matchEquation("ψ ̃ ∮ ≈ (2)", equations);
    expect(match).toBeUndefined();
  });

  it("A4 falls back to text when two equations carry the number and the symbols tell them apart", () => {
    const equations = [quadratic(["2"]), diffusion(["2"]), energy(["3"])];
    const match = matchEquation("∂ u ∂ t = α ∇ 2 u (2)", equations);
    expect(match?.by).toBe("text");
    expect(match?.equation).toBe(equations[1]);
  });

  it("A4 falls through to text when no equation has the number", () => {
    const equations = [quadratic(["1"]), diffusion(["2"]), energy(["3"])];
    const match = matchEquation("∂ u ∂ t = α ∇ 2 u (9)", equations);
    expect(match?.by).toBe("text");
    expect(match?.equation).toBe(equations[1]);
  });

  it("A4 returns undefined when the number is unknown and the symbols match nothing", () => {
    const equations = [quadratic(["1"]), diffusion(["2"])];
    expect(matchEquation("ζ ξ η 7 7 7 (9)", equations)).toBeUndefined();
  });

  it("A4 does not take parentheses around an expression for a number", () => {
    const equations = [quadratic(["1"]), diffusion(["2"]), energy(["3"])];
    const match = matchEquation("E = m c 2 + ∑ i = 1 N λ i (i + 1)", equations);
    expect(match?.by).toBe("text");
    expect(match?.equation).toBe(equations[2]);
  });
});

describe("matchEquation by text", () => {
  it("1.3b matches an unnumbered display by its symbols", () => {
    const equations = [quadratic(), diffusion(), energy()];
    const match = matchEquation("∂ u ∂ t = α ∇ 2 u", equations);
    expect(match?.by).toBe("text");
    expect(match?.equation).toBe(equations[1]);
  });

  it("1.3b reports a score between the 0.6 threshold and 1", () => {
    const equations = [quadratic(), diffusion(), energy()];
    const match = matchEquation("α x 2 + β x + γ = 0", equations);
    expect(match?.equation).toBe(equations[0]);
    expect(match?.score).toBeGreaterThanOrEqual(0.6);
    expect(match?.score).toBeLessThanOrEqual(1);
  });

  it("1.3b matches Unicode Greek letters against TeX commands", () => {
    const equations = [eq("\\alpha + \\beta = \\gamma \\delta"), eq("\\mu \\nu \\xi = \\pi + \\rho")];
    const match = matchEquation("α + β = γ δ", equations);
    expect(match?.equation).toBe(equations[0]);
  });

  it("1.3b matches a sum, an integral and infinity written as Unicode symbols", () => {
    const equations = [eq("\\sum_{n=1}^{\\infty} a_n"), eq("\\int_0^1 f(x) \\, d x")];
    const sum = matchEquation("∑ n = 1 ∞ a n", equations);
    expect(sum?.equation).toBe(equations[0]);
    const integral = matchEquation("∫ 0 1 f ( x ) d x", equations);
    expect(integral?.equation).toBe(equations[1]);
  });

  it("1.3b ignores spacing commands in the source body", () => {
    const equations = [eq("a \\, b \\quad c \\; d \\! = 0"), eq("p q r s = 1")];
    const match = matchEquation("a b c d = 0", equations);
    expect(match?.equation).toBe(equations[0]);
    expect(match?.score).toBeGreaterThanOrEqual(0.9);
  });

  it("1.3b ignores braces in the source body", () => {
    const equations = [eq("{x}_{{i}} + {y}^{{j}} = {z}"), eq("p q r s = 1")];
    const match = matchEquation("x i + y j = z", equations);
    expect(match?.equation).toBe(equations[0]);
    expect(match?.score).toBeGreaterThanOrEqual(0.9);
  });

  it("1.3b does not depend on token order", () => {
    const equations = [quadratic(), diffusion(), energy()];
    const match = matchEquation("0 = γ + β x + α x 2", equations);
    expect(match?.equation).toBe(equations[0]);
  });

  it("1.3b returns undefined when no equation reaches the 0.6 score", () => {
    const equations = [quadratic(), diffusion(), energy()];
    expect(matchEquation("ζ ξ η θ 7 7 7", equations)).toBeUndefined();
  });

  it("1.3b returns undefined when only a small part of the equation is in the box", () => {
    const long = eq("a b c d e f g h i j k l m n o p = 1 2 3 4");
    expect(matchEquation("a b", [long])).toBeUndefined();
  });

  const common = "a b c d e f g h i j k l m n o p q r s t u v w x y z";
  const twin = (last: string): SourceEquation => eq(`${common} + ${last} = 0`);

  it("1.3b gives undefined for two near-identical equations", () => {
    const equations = [twin("k"), twin("m")];
    expect(matchEquation(`${common} + k = 0`, equations)).toBeUndefined();
  });

  it("1.3b gives undefined when the box cannot tell two equations apart", () => {
    const equations = [twin("k"), twin("m")];
    expect(matchEquation(`${common} + = 0`, equations)).toBeUndefined();
  });

  it("1.3b gives undefined for two identical equations", () => {
    const equations = [diffusion(), diffusion()];
    expect(matchEquation("∂ u ∂ t = α ∇ 2 u", equations)).toBeUndefined();
  });

  it("1.3b still matches when the runner-up is clearly worse", () => {
    const equations = [diffusion(), eq("\\partial u = 0"), energy()];
    const match = matchEquation("∂ u ∂ t = α ∇ 2 u", equations);
    expect(match?.equation).toBe(equations[0]);
  });
});

describe("matchEquation edge cases", () => {
  it("A4 returns undefined for an empty box text", () => {
    expect(matchEquation("", [quadratic(["1"]), diffusion(["2"])])).toBeUndefined();
  });

  it("A4 returns undefined for a whitespace-only box text", () => {
    expect(matchEquation("  \n\t ", [quadratic(["1"]), diffusion(["2"])])).toBeUndefined();
  });

  it("A4 returns undefined when there are no equations", () => {
    expect(matchEquation("α x 2 + β x + γ = 0 (1)", [])).toBeUndefined();
  });
});
