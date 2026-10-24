// Tests the library's tag list: case-insensitive dedupe with the first spelling, A to Z order, and paper counts.
import { libraryTags } from "../../../../src/libraryUi/derive";

describe("libraryTags", () => {
  it("lists each tag once, first spelling wins, sorted A to Z, with its paper count", () => {
    const tags = libraryTags([{ tags: ["NLP", "graphs"] }, { tags: ["nlp"] }, {}, { tags: ["Deep learning", "graphs", "GRAPHS"] }]);
    expect(tags).toEqual([{ tag: "Deep learning", count: 1 }, { tag: "graphs", count: 2 }, { tag: "NLP", count: 2 }]);
  });

  it("is empty when no paper has tags", () => {
    expect(libraryTags([{}, { tags: [] }])).toEqual([]);
  });
});
