import { tagQuery } from "../../src/library-ui";

describe("tagQuery", () => {
  it("writes a single-word tag as tag:word, lower-cased", () => {
    expect(tagQuery("AI")).toBe("tag:ai");
  });

  it("quotes a multi-word tag so it matches as one tag", () => {
    expect(tagQuery("Deep  Learning")).toBe('tag:"deep learning"');
  });

  it("drops quotes inside a tag and returns an empty query for an empty tag", () => {
    expect(tagQuery('say "hi"')).toBe('tag:"say hi"');
    expect(tagQuery('  "" ')).toBe("");
  });
});
