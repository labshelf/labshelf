import { lineStartsOf } from "../../../src/latex/sourceCommands";

describe("lineStartsOf", () => {
  it("starts an empty text at 0", () => {
    expect(lineStartsOf("")).toEqual([0]);
  });

  it("adds the index after every newline, including a trailing one", () => {
    expect(lineStartsOf("a\nb\n")).toEqual([0, 2, 4]);
  });
});
