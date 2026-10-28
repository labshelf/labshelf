import { parseUiMessage, parseDetailsMessage } from "../../../src/libraryUi/protocol";

describe("paper note messages", () => {
  const accepted = [
    { type: "paper.addNote", id: "p1", body: "A first thought" },
    { type: "paper.addNote", id: "p1", body: "line one\nline two" },
    { type: "paper.editNote", id: "p1", itemId: "n1", body: "Revised" },
    { type: "paper.removeNote", id: "p1", itemId: "n1" },
  ];

  it("6.4a accepts paper.addNote, paper.editNote and paper.removeNote with valid fields", () => {
    for (const m of accepted) expect(parseUiMessage(m)).toEqual(m);
  });

  it("6.4a accepts the three messages inside a library envelope", () => {
    for (const m of accepted) {
      expect(parseDetailsMessage({ channel: "library", msg: m })).toEqual({ channel: "library", msg: m });
    }
  });

  it("6.4a drops paper.addNote with a missing or mistyped field", () => {
    const bad = [
      { type: "paper.addNote" },
      { type: "paper.addNote", id: "p1" },
      { type: "paper.addNote", body: "x" },
      { type: "paper.addNote", id: "", body: "x" },
      { type: "paper.addNote", id: 7, body: "x" },
      { type: "paper.addNote", id: "p1", body: 3 },
      { type: "paper.addNote", id: "p1", body: null },
      { type: "paper.addNote", id: "p1", body: ["x"] },
    ];
    for (const m of bad) expect(parseUiMessage(m)).toBeNull();
  });

  it("6.4a drops paper.editNote with a missing or mistyped field", () => {
    const bad = [
      { type: "paper.editNote" },
      { type: "paper.editNote", id: "p1", itemId: "n1" },
      { type: "paper.editNote", id: "p1", body: "x" },
      { type: "paper.editNote", itemId: "n1", body: "x" },
      { type: "paper.editNote", id: "", itemId: "n1", body: "x" },
      { type: "paper.editNote", id: "p1", itemId: "", body: "x" },
      { type: "paper.editNote", id: "p1", itemId: 1, body: "x" },
      { type: "paper.editNote", id: 1, itemId: "n1", body: "x" },
      { type: "paper.editNote", id: "p1", itemId: "n1", body: 5 },
      { type: "paper.editNote", id: "p1", itemId: "n1", body: undefined },
    ];
    for (const m of bad) expect(parseUiMessage(m)).toBeNull();
  });

  it("6.4a drops paper.removeNote with a missing or mistyped field", () => {
    const bad = [
      { type: "paper.removeNote" },
      { type: "paper.removeNote", id: "p1" },
      { type: "paper.removeNote", itemId: "n1" },
      { type: "paper.removeNote", id: "", itemId: "n1" },
      { type: "paper.removeNote", id: "p1", itemId: "" },
      { type: "paper.removeNote", id: "p1", itemId: null },
      { type: "paper.removeNote", id: 2, itemId: "n1" },
    ];
    for (const m of bad) expect(parseUiMessage(m)).toBeNull();
  });

  it("6.4a drops a note message that fails its guard when wrapped in a library envelope", () => {
    expect(parseDetailsMessage({ channel: "library", msg: { type: "paper.editNote", id: "p1", body: "x" } })).toBeNull();
    expect(parseDetailsMessage({ channel: "projects", msg: accepted[0] })).toBeNull();
  });

  it("6.4c no longer accepts paper.setNote", () => {
    expect(parseUiMessage({ type: "paper.setNote", id: "p1", note: "text" })).toBeNull();
    expect(parseUiMessage({ type: "paper.setNote", id: "p1", note: "" })).toBeNull();
    expect(parseDetailsMessage({ channel: "library", msg: { type: "paper.setNote", id: "p1", note: "text" } })).toBeNull();
  });
});
