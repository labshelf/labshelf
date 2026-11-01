// Tests splitSteps (plan D9): the steps of one math are its top-level `=` / `&=` pairs, chained across aligned lines, with TeX offsets.
import { splitSteps } from "../../../src/qmd/math/splitSteps";

const sides = (tex: string) => splitSteps(tex).map((s) => [s.lhs.trim(), s.rhs.trim()]);
const squash = (s: string) => s.replace(/[\s&]/g, "");

describe("4.1a top-level equals", () => {
  it("4.1a gives one step for a single equation", () => {
    expect(sides("a = b")).toEqual([["a", "b"]]);
  });

  it("4.1a chains a = b = c into a = b and b = c", () => {
    expect(sides("a = b = c")).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("4.1a reads \\sum_{k=0}^{n} a = b = c as a = b and b = c only", () => {
    expect(sides("\\sum_{k=0}^{n} a = b = c")).toEqual([
      ["\\sum_{k=0}^{n} a", "b"],
      ["b", "c"],
    ]);
  });

  it("4.1a returns no step for a math without an equals sign", () => {
    expect(splitSteps("x^2 + 1")).toEqual([]);
  });

  it("4.1a returns no step for an empty math", () => {
    expect(splitSteps("")).toEqual([]);
  });
});

describe("4.1a aligned blocks", () => {
  it("4.1a chains the lines of an aligned environment", () => {
    expect(sides("\\begin{aligned} a &= b \\\\ &= c \\\\ &= d \\end{aligned}")).toEqual([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
    ]);
  });

  it("4.1a chains the lines of an align* environment", () => {
    expect(sides("\\begin{align*} x &= y \\\\ &= z \\end{align*}")).toEqual([
      ["x", "y"],
      ["y", "z"],
    ]);
  });

  it("4.1a chains the lines of a split environment", () => {
    expect(sides("\\begin{split} x &= y \\\\ &= z \\end{split}")).toEqual([
      ["x", "y"],
      ["y", "z"],
    ]);
  });

  it("4.1a chains lines written with &= and no environment", () => {
    expect(sides("a &= b \\\\ &= c")).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("4.1a keeps a line that starts with its own left side as a separate step", () => {
    expect(sides("\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("4.1a gives steps of different aligned lines different line numbers, in order", () => {
    const steps = splitSteps("\\begin{aligned} a &= b \\\\ &= c \\\\ &= d \\end{aligned}");
    expect(steps).toHaveLength(3);
    expect(steps[1]!.line).toBe(steps[0]!.line + 1);
    expect(steps[2]!.line).toBe(steps[1]!.line + 1);
  });

  it("4.1a gives the steps of one line the same line number", () => {
    const steps = splitSteps("a = b = c");
    expect(steps).toHaveLength(2);
    expect(steps[1]!.line).toBe(steps[0]!.line);
  });
});

describe("A7 steps split at top-level equals only", () => {
  it("A7 ignores an equals inside braces in a superscript", () => {
    expect(sides("x^{a=b} = c")).toEqual([["x^{a=b}", "c"]]);
  });

  it("A7 ignores an equals inside braces in a subscript", () => {
    expect(sides("a_{i=1} = b")).toEqual([["a_{i=1}", "b"]]);
  });

  it("A7 ignores an equals inside a group that has no script", () => {
    expect(sides("\\frac{a=b}{c} = d")).toEqual([["\\frac{a=b}{c}", "d"]]);
  });

  it("A7 ignores an equals inside \\text{}", () => {
    expect(sides("\\text{a = b} = c")).toEqual([["\\text{a = b}", "c"]]);
  });

  it("A7 does not read \\leq as a step", () => {
    expect(splitSteps("a \\leq b")).toEqual([]);
  });

  it("A7 does not read \\neq as a step", () => {
    expect(splitSteps("a \\neq b")).toEqual([]);
  });

  it("A7 does not read \\approx as a step", () => {
    expect(splitSteps("a \\approx b")).toEqual([]);
  });

  it("A7 ignores an equals inside braces on a line of an aligned block", () => {
    expect(sides("\\begin{aligned} \\sum_{k=0}^{n} a &= b \\\\ &= c \\end{aligned}")).toEqual([
      ["\\sum_{k=0}^{n} a", "b"],
      ["b", "c"],
    ]);
  });
});

describe("4.1a offsets", () => {
  it("4.1a gives from and to that cover each step of a plain chain", () => {
    const tex = "a = b = c";
    const steps = splitSteps(tex);
    expect(steps).toHaveLength(2);
    for (const s of steps) {
      expect(s.from).toBeGreaterThanOrEqual(0);
      expect(s.to).toBeLessThanOrEqual(tex.length);
      expect(squash(tex.slice(s.from, s.to))).toBe(squash(`${s.lhs}=${s.rhs}`));
    }
  });

  it("4.1a gives from and to that cover a step after a \\sum_{k=0} prefix", () => {
    const tex = "\\sum_{k=0}^{n} a = b";
    const s = splitSteps(tex)[0]!;
    expect(squash(tex.slice(s.from, s.to))).toBe(squash(tex));
  });

  it("4.1a ends each aligned step at the end of its right side, in increasing order", () => {
    const tex = "\\begin{aligned} a &= b \\\\ &= c \\\\ &= d \\end{aligned}";
    const steps = splitSteps(tex);
    expect(steps).toHaveLength(3);
    steps.forEach((s) => {
      expect(s.from).toBeLessThan(s.to);
      expect(s.to).toBeLessThanOrEqual(tex.length);
      expect(tex.slice(s.from, s.to).trimEnd().endsWith(s.rhs.trim())).toBe(true);
    });
    expect(steps[0]!.to).toBeLessThan(steps[1]!.to);
    expect(steps[1]!.to).toBeLessThan(steps[2]!.to);
    expect(tex.slice(steps[1]!.to - 1, steps[1]!.to)).toBe("c");
    expect(tex.slice(steps[2]!.to - 1, steps[2]!.to)).toBe("d");
  });
});
