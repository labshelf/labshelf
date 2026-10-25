/** Verifies the figure input pattern language: literals, `*`, `?` and `**`. */
import { isGlobPattern, isInputPatternMatch } from "../../../src/writing/figures/index";

describe("isInputPatternMatch", () => {
  it("matches a literal path exactly", () => {
    expect(isInputPatternMatch("plot.py", "plot.py")).toBe(true);
    expect(isInputPatternMatch("plot.py", "src/plot.py")).toBe(false);
    expect(isInputPatternMatch("plot.py", "plot.pyc")).toBe(false);
  });

  it("reads ./ as the project folder", () => {
    expect(isInputPatternMatch("./plot.py", "plot.py")).toBe(true);
  });

  it("lets * match inside one segment only", () => {
    expect(isInputPatternMatch("results/*.json", "results/a.json")).toBe(true);
    expect(isInputPatternMatch("results/*.json", "results/.json")).toBe(true);
    expect(isInputPatternMatch("results/*.json", "results/deep/a.json")).toBe(false);
    expect(isInputPatternMatch("results/*.json", "results/a.csv")).toBe(false);
    expect(isInputPatternMatch("a*b*c", "aXXbYYc")).toBe(true);
    expect(isInputPatternMatch("a*b*c", "aXXbYY")).toBe(false);
  });

  it("lets ? match exactly one character of a segment", () => {
    expect(isInputPatternMatch("run?.csv", "run1.csv")).toBe(true);
    expect(isInputPatternMatch("run?.csv", "run.csv")).toBe(false);
    expect(isInputPatternMatch("run?.csv", "run12.csv")).toBe(false);
    expect(isInputPatternMatch("run?", "run/")).toBe(false);
  });

  it("lets ** match zero segments", () => {
    expect(isInputPatternMatch("data/**/x.csv", "data/x.csv")).toBe(true);
    expect(isInputPatternMatch("**/x.csv", "x.csv")).toBe(true);
  });

  it("lets ** match many segments", () => {
    expect(isInputPatternMatch("data/**/x.csv", "data/a/b/c/x.csv")).toBe(true);
    expect(isInputPatternMatch("data/**", "data/a/b.csv")).toBe(true);
    expect(isInputPatternMatch("data/**/x.csv", "other/a/x.csv")).toBe(false);
    expect(isInputPatternMatch("data/**/x.csv", "data/a/y.csv")).toBe(false);
  });

  it("escapes nothing: regex characters are literal", () => {
    expect(isInputPatternMatch("a+b(1).py", "a+b(1).py")).toBe(true);
    expect(isInputPatternMatch("a.py", "aXpy")).toBe(false);
  });
});

describe("isGlobPattern", () => {
  it("tells a literal path from a pattern", () => {
    expect(isGlobPattern("plot.py")).toBe(false);
    expect(isGlobPattern("results/*.json")).toBe(true);
    expect(isGlobPattern("a?.py")).toBe(true);
    expect(isGlobPattern("**/x")).toBe(true);
  });
});
