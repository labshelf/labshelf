/**
 * @jest-environment jsdom
 */
// Tests what the library detail pane's Notes tab asks of the host: opening the paper's notes from a row or New note, and nothing else.
import { ALL_CAPABILITIES, mountForTest, paper } from "./mountHarness";

const notes = [{ id: "n1", anchor: "", body: "## First\nText", created: "2026-10-01T00:00:00.000Z", author: "Ana" }];

function open(prefs: { readOnly?: boolean } = {}) {
  const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.host.post({ type: "select", id: "a" });
  t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes }, ...prefs } as never);
  return t;
}

describe("library detail pane Notes tab", () => {
  it("posts paper.openNotes from a note row and from New note", () => {
    const t = open();
    t.click(".note-row", t.detail());
    t.click(".note-new", t.detail());
    expect(t.sent.filter((m) => m.type === "paper.openNotes")).toEqual([{ type: "paper.openNotes", id: "a" }, { type: "paper.openNotes", id: "a" }]);
  });

  it("posts no note editing or cell message when a note row is used", () => {
    const t = open();
    t.click(".note-row", t.detail());
    expect(t.sent.map((m) => m.type).filter((type) => /^paper\.(editNote|addNote|removeNote|runCell|evalMath)/.test(type))).toEqual([]);
  });
});
