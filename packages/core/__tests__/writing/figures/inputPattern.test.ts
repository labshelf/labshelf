/** Verifies the figure input pattern language: literals, `*`, `?` and `**`. */
import { isGlobPattern, matchesInputPattern } from "../../../src/writing/figures/index";

describe("matchesInputPattern", () => {
  it("matches a literal path exactly", () => {
    expect(matchesInputPattern("plot.py", "plot.py")).toBe(true);
    expect(matchesInputPattern("plot.py", "src/plot.py")).toBe(false);
    expect(matchesInputPattern("plot.py", "plot.pyc")).toBe(false);
  });

  it("reads ./ as the project folder", () => {
    expect(matchesInputPattern("./plot.py", "plot.py")).toBe(true);
  });

  it("lets * match inside one segment only", () => {
    expect(matchesInputPattern("results/*.json", "results/a.json")).toBe(true);
    expect(matchesInputPattern("results/*.json", "results/.json")).toBe(true);
    expect(matchesInputPattern("results/*.json", "results/deep/a.json")).toBe(false);
    expect(matchesInputPattern("results/*.json", "results/a.csv")).toBe(false);
    expect(matchesInputPattern("a*b*c", "aXXbYYc")).toBe(true);
    expect(matchesInputPattern("a*b*c", "aXXbYY")).toBe(false);
  });

  it("lets ? match exactly one character of a segment", () => {
    expect(matchesInputPattern("run?.csv", "run1.csv")).toBe(true);
    expect(matchesInputPattern("run?.csv", "run.csv")).toBe(false);
    expect(matchesInputPattern("run?.csv", "run12.csv")).toBe(false);
    expect(matchesInputPattern("run?", "run/")).toBe(false);
  });

  it("lets ** match zero segments", () => {
    expect(matchesInputPattern("data/**/x.csv", "data/x.csv")).toBe(true);
    expect(matchesInputPattern("**/x.csv", "x.csv")).toBe(true);
  });

  it("lets ** match many segments", () => {
    expect(matchesInputPattern("data/**/x.csv", "data/a/b/c/x.csv")).toBe(true);
    expect(matchesInputPattern("data/**", "data/a/b.csv")).toBe(true);
    expect(matchesInputPattern("data/**/x.csv", "other/a/x.csv")).toBe(false);
    expect(matchesInputPattern("data/**/x.csv", "data/a/y.csv")).toBe(false);
  });

  it("escapes nothing: regex characters are literal", () => {
    expect(matchesInputPattern("a+b(1).py", "a+b(1).py")).toBe(true);
    expect(matchesInputPattern("a.py", "aXpy")).toBe(false);
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
