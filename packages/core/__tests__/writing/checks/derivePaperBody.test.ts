/** Verifies where a paper's body ends: the references heading, ignoring running headers and page numbers. */
import { derivePaperBody } from "../../../src/writing/checks/derivePaperBody";

const header = "Under review as a conference paper at ICLR 2027";

describe("derivePaperBody", () => {
  it("counts every page when there is no references heading", () => {
    expect(derivePaperBody([["a"], ["b"]])).toEqual({ contentPages: 2, headingFound: false, pages: [["a"], ["b"]] });
  });

  it("counts the heading's page when body text precedes the heading on it", () => {
    const body = derivePaperBody([["Intro", "1"], ["Conclusion text", "6 References", "[1] Doe. 2020.", "2"]]);
    expect(body.contentPages).toBe(2);
    expect(body.pages).toEqual([["Intro", "1"], ["Conclusion text"]]);
  });

  it("does not count a page that starts with the references under a running header", () => {
    const body = derivePaperBody([[header, "Intro", "1"], [header, "Method", "2"], [header, "References", "[1] Doe.", "3"]]);
    expect(body).toMatchObject({ contentPages: 2, headingFound: true });
    expect(body.pages[2]).toEqual([header]);
  });

  it.each(["References", "REFERENCES", "Bibliography", "7 References", "A. References", "7.1. References"])("recognises the heading %j", (heading) => {
    expect(derivePaperBody([["text"], [heading]]).contentPages).toBe(1);
  });

  it("ignores a sentence that mentions references", () => {
    expect(derivePaperBody([["text"], ["References to prior work are in Section 2."]]).headingFound).toBe(false);
  });
});
