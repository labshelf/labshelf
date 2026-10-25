// Tests that only highlights with text are kept for quoting.
import type { Annotation } from "../../../src/model/index";
import { listQuotableHighlights } from "../../../src/writing/citations/index";

const annotation = (type: string, content: string) => ({ type, content }) as unknown as Annotation;

describe("listQuotableHighlights", () => {
  it("keeps highlights with text and drops empty ones and other types", () => {
    const kept = annotation("highlight", "text");
    expect(listQuotableHighlights([kept, annotation("highlight", "  "), annotation("note", "text")])).toEqual([kept]);
  });
});
