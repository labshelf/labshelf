import { createTagQuery } from "../../src/libraryUi";

describe("tagQuery", () => {
  it("writes a single-word tag as tag:word, lower-cased", () => {
    expect(createTagQuery("AI")).toBe("tag:ai");
  });

  it("quotes a multi-word tag so it matches as one tag", () => {
    expect(createTagQuery("Deep  Learning")).toBe('tag:"deep learning"');
  });

  it("drops quotes inside a tag and returns an empty query for an empty tag", () => {
    expect(createTagQuery('say "hi"')).toBe('tag:"say hi"');
    expect(createTagQuery('  "" ')).toBe("");
  });
});
