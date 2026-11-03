/** The openDeckView preview request: a build root and a present or poster view, refused otherwise. */
import { checkPreviewRequest } from "../../src/reader/protocol/previewProtocol";

describe("openDeckView guard", () => {
  it("passes with a root and view present or poster", () => {
    expect(checkPreviewRequest({ command: "openDeckView", root: "talks/t/main.tex", view: "present" })).toBe(true);
    expect(checkPreviewRequest({ command: "openDeckView", root: "posters/p/main.typ", view: "poster" })).toBe(true);
  });

  it("is refused without a root or with another view", () => {
    expect(checkPreviewRequest({ command: "openDeckView", view: "present" })).toBe(false);
    expect(checkPreviewRequest({ command: "openDeckView", root: "", view: "present" })).toBe(false);
    expect(checkPreviewRequest({ command: "openDeckView", root: 3, view: "poster" })).toBe(false);
    expect(checkPreviewRequest({ command: "openDeckView", root: "talks/t/main.tex" })).toBe(false);
    expect(checkPreviewRequest({ command: "openDeckView", root: "talks/t/main.tex", view: "edit" })).toBe(false);
  });
});
