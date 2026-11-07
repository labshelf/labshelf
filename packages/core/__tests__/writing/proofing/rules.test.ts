import { checkSimpleRules, findProseRanges, proseWords, type RuleFinding } from "../../../src/writing/proofing/index.js";

function check(text: string, tag = "en-US"): RuleFinding[] {
  return checkSimpleRules(text, findProseRanges("latex", text), tag);
}

function applyFix(text: string, finding: RuleFinding): string {
  return text.slice(0, finding.fix.from) + finding.fix.insert + text.slice(finding.fix.to);
}

describe("checkSimpleRules", () => {
  it("finds a repeated word and fixes it to one", () => {
    const text = "I saw the the cat.";
    const findings = check(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe("repeatedWord");
    expect(applyFix(text, findings[0]!)).toBe("I saw the cat.");
  });

  it("finds a repeated word case-insensitively and across a line break", () => {
    const text = "The\nthe end.";
    const findings = check(text);
    expect(findings.map((f) => f.rule)).toEqual(["repeatedWord"]);
    expect(applyFix(text, findings[0]!)).toBe("The end.");
  });

  it("does not join words across a blank line or markup", () => {
    expect(check("the\n\nthe end.")).toEqual([]);
    expect(check("the $x$ the end.")).toEqual([]);
  });

  it("finds a double space between words and fixes it to one", () => {
    const text = "one  two";
    const findings = check(text);
    expect(findings.map((f) => f.rule)).toEqual(["doubleSpace"]);
    expect(applyFix(text, findings[0]!)).toBe("one two");
  });

  it("does not flag indentation or trailing spaces before a line break", () => {
    expect(check("    Indented line.\nEnd of sentence.  \nNext one.")).toEqual([]);
  });

  it("finds a space before punctuation and removes it", () => {
    const text = "word , next";
    const findings = check(text);
    expect(findings.map((f) => f.rule)).toEqual(["spaceBeforePunctuation"]);
    expect(applyFix(text, findings[0]!)).toBe("word, next");
  });

  it("flags 'mot ;' in English but not in French, where a comma still counts", () => {
    expect(check("un mot ; deux", "en").map((f) => f.rule)).toEqual(["spaceBeforePunctuation"]);
    expect(check("un mot ; deux mots !", "fr-FR")).toEqual([]);
    expect(check("un mot , deux", "fr").map((f) => f.rule)).toEqual(["spaceBeforePunctuation"]);
  });

  it("leaves an ellipsis and a decimal alone", () => {
    expect(check("wait ... and .5 more")).toEqual([]);
  });
});

describe("proseWords", () => {
  it("skips acronyms, words with digits and words with accent commands", () => {
    const text = "Well-known NASA mp3 caf\\'e it's";
    const words = proseWords(text, findProseRanges("latex", text)).map((w) => w.word);
    expect(words).toEqual(["Well-known", "it's"]);
  });
});
