/** Verifies which citation keys are found in LaTeX and Typst sources. */
import { citedKeys, scanCitationKeys } from "../../../src/writing/citations/index";

describe("scanCitationKeys in LaTeX", () => {
  it.each([
    ["\\cite{a}", ["a"]],
    ["\\citep[p.~3]{a, b}", ["a", "b"]],
    ["\\citet*[see][ch. 2]{a}", ["a"]],
    ["\\autocite{a} \\parencite{b} \\textcite{c} \\footcite{d}", ["a", "b", "c", "d"]],
    ["\\nocite{a}\\Citeauthor{b}", ["a", "b"]],
    ["\\cite {a}", ["a"]],
  ])("finds the keys of %s", (text, keys) => {
    expect(scanCitationKeys("latex", text)).toEqual(keys);
  });

  it("ignores commented-out citations but not an escaped percent", () => {
    expect(scanCitationKeys("latex", "50\\% of \\cite{kept} % \\cite{dropped}\n% \\cite{gone}")).toEqual(["kept"]);
  });

  it("drops duplicates, empty keys and the cite-everything star", () => {
    expect(scanCitationKeys("latex", "\\cite{a,,a}\\nocite{*}\\cite{b}")).toEqual(["a", "b"]);
  });
});

describe("scanCitationKeys in Typst", () => {
  it.each([
    ["see @smith2020.", ["smith2020"]],
    ["@a:b and @c_d-e", ["a:b", "c_d-e"]],
    ["#cite(<a>) #cite(label(\"b\"), form: \"prose\")", ["a", "b"]],
    ["@café2021", ["café2021"]],
  ])("finds the keys of %s", (text, keys) => {
    expect(scanCitationKeys("typst", text)).toEqual(keys);
  });

  it("ignores e-mail addresses and comments", () => {
    const text = "mail me@example.org // @line\n/* @block\n@still */ @kept https://x.org/@user";
    expect(scanCitationKeys("typst", text)).toEqual(["kept"]);
  });
});

describe("citedKeys page and command", () => {
  it.each([
    ["\\cite[p.~4]{a}", 4],
    ["\\cite[see][p.~4]{a}", 4],
    ["\\citep[p.~12]{a}", 12],
  ])("reads the page of %s", (text, page) => {
    expect(citedKeys("latex", text).map((cited) => cited.page)).toEqual([page]);
  });

  it("leaves the page out when no argument names one", () => {
    const [plain, other] = citedKeys("latex", "\\cite{a} \\cite[see]{b} \\cite[ch. 2]{c}");
    expect(plain).not.toHaveProperty("page");
    expect(other).not.toHaveProperty("page");
    expect(citedKeys("typst", "@a")[0]).not.toHaveProperty("page");
  });

  it("gives every key of a command the command text and page", () => {
    const [first, second] = citedKeys("latex", "x \\citep[p.~4]{a, b} y");
    expect(first).toMatchObject({ key: "a", page: 4, command: "\\citep[p.~4]{a, b}" });
    expect(second).toMatchObject({ key: "b", page: 4, command: "\\citep[p.~4]{a, b}" });
  });

  it("gives a Typst reference and cite call as the command", () => {
    expect(citedKeys("typst", "see @a and #cite(<b>)").map((cited) => cited.command)).toEqual(["@a", "#cite(<b>)"]);
  });
});
