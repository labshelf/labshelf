// Tests that the gallery protocol guards accept well-formed messages and reject malformed ones.
import { parseGalleryMessage } from "../../../src/templates/protocol";

describe("parseGalleryMessage", () => {
  it("passes every well-formed message through", () => {
    const messages = [
      { type: "ready" },
      { type: "refresh" },
      { type: "thumbnails", templates: [{ source: "community", id: "ieee-conference" }, { source: "universe", id: "charged-ieee" }] },
      { type: "thumbnails", templates: [] },
      { type: "detail", template: { source: "mine", id: "lab-report" } },
      { type: "use", template: { source: "universe", id: "charged-ieee" } },
    ];
    for (const m of messages) expect(parseGalleryMessage(m)).toEqual(m);
  });

  it("refuses non-objects and unknown types", () => {
    for (const bad of [null, undefined, "ready", 7, [], { type: "toString" }, { type: "nope" }, { type: 3 }, {}]) {
      expect(parseGalleryMessage(bad)).toBeNull();
    }
  });

  it("refuses missing or mistyped template keys", () => {
    const bad = [
      { type: "detail" },
      { type: "detail", template: null },
      { type: "detail", template: "community/ieee" },
      { type: "detail", template: { source: "github", id: "ieee" } },
      { type: "detail", template: { source: "community" } },
      { type: "use", template: { source: "community", id: "" } },
      { type: "use", template: { source: "community", id: 42 } },
      { type: "use", template: { source: "community", id: "x".repeat(215) } },
      { type: "thumbnails" },
      { type: "thumbnails", templates: { source: "community", id: "ieee" } },
      { type: "thumbnails", templates: [{ source: "community", id: "ieee" }, { source: "community" }] },
    ];
    for (const m of bad) expect(parseGalleryMessage(m)).toBeNull();
  });

  it("refuses a thumbnail batch larger than a page of cards", () => {
    const templates = Array.from({ length: 201 }, (_, i) => ({ source: "universe", id: `t${i}` }));
    expect(parseGalleryMessage({ type: "thumbnails", templates })).toBeNull();
  });
});

describe("parseGalleryMessage publish messages", () => {
  const project = { id: "p1", title: "My Thesis", engineLabel: "pdfLaTeX" };
  const draft = { name: "My Thesis", category: "thesis", license: "MIT", description: "d" };

  it("passes the publish messages through", () => {
    const messages = [
      { type: "publish.start" },
      { type: "publish.check", project, draft },
      { type: "publish.signIn" },
      { type: "publish.submit", project, draft },
    ];
    for (const m of messages) expect(parseGalleryMessage(m)).toEqual(m);
  });

  it("refuses publish messages with a missing or mistyped project or draft", () => {
    const bad = [
      { type: "publish.check", project },
      { type: "publish.check", draft },
      { type: "publish.check", project, draft: "x" },
      { type: "publish.check", project, draft: { ...draft, name: 3 } },
      { type: "publish.submit", project: { id: "p1" }, draft },
      { type: "publish.submit", project: null, draft },
      { type: "publish.submit", project, draft: { name: "n" } },
    ];
    for (const m of bad) expect(parseGalleryMessage(m)).toBeNull();
  });
});
