// Tests that the reader's citeInProject message is validated before a host sees it.
import { isWebviewMessage } from "../../../src/reader/protocol";

describe("isWebviewMessage citeInProject", () => {
  it("accepts a paper id alone", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1" })).toBe(true);
  });

  it("accepts a page and a quote", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", page: 12, quote: "A quoted passage." })).toBe(true);
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: "x".repeat(2000) })).toBe(true);
  });

  it.each([undefined, 7, null, {}])("rejects the paper id %p", (paperId) => {
    expect(isWebviewMessage({ command: "citeInProject", paperId })).toBe(false);
  });

  it("rejects an empty paper id", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "" })).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, "3"])("rejects the page %p", (page) => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", page })).toBe(false);
  });

  it("rejects a quote over 2,000 characters or that is not text", () => {
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: "x".repeat(2001) })).toBe(false);
    expect(isWebviewMessage({ command: "citeInProject", paperId: "p1", quote: 5 })).toBe(false);
  });
});
