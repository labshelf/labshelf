import { isWebviewMessage } from "../../../src/reader/protocol/index";
import type { HostToWebview, ReaderNote } from "../../../src/reader/protocol/messages";

const BOX = "p2 box 0.1 0.2 0.3 0.4";

describe("note messages", () => {
  describe("7.2a accepts valid note messages", () => {
    it("7.2a accepts addNote with a highlight anchor", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "hl:ann-1", body: "text" })).toBe(true);
    });

    it("7.2a accepts addNote with a box anchor", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: BOX, body: "text" })).toBe(true);
    });

    it("7.2a accepts addNote with an empty (unanchored) anchor", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "", body: "text" })).toBe(true);
    });

    it("7.2a accepts editNote", () => {
      expect(isWebviewMessage({ command: "editNote", id: "n1", body: "new text" })).toBe(true);
    });

    it("7.2a accepts moveNote with a box anchor", () => {
      expect(isWebviewMessage({ command: "moveNote", id: "n1", anchor: BOX })).toBe(true);
    });

    it("7.2a accepts moveNote with an empty anchor", () => {
      expect(isWebviewMessage({ command: "moveNote", id: "n1", anchor: "" })).toBe(true);
    });

    it("7.2a accepts removeNote", () => {
      expect(isWebviewMessage({ command: "removeNote", id: "n1" })).toBe(true);
    });

    it("7.2a ReaderNote and the host messages carry the note list", () => {
      const note: ReaderNote = { id: "n1", anchor: "", body: "b", created: "2025-01-01T00:00:00.000Z", author: "me" };
      const update: HostToWebview = { type: "updateNotes", items: [note] };
      expect(update.type).toBe("updateNotes");
      expect(update).toEqual({ type: "updateNotes", items: [note] });
    });
  });

  describe("7.2b rejects malformed note messages", () => {
    it("7.2b rejects addNote with an anchor of unknown kind", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "garbage", body: "text" })).toBe(false);
    });

    it("7.2b rejects addNote with a malformed box anchor", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "p0 box 0.1 0.1 0.2 0.2", body: "text" })).toBe(false);
    });

    it("7.2b rejects addNote with a non-string body", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "", body: 5 })).toBe(false);
    });

    it("7.2b rejects addNote with a non-string anchor", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: 5, body: "text" })).toBe(false);
    });

    it("7.2b rejects addNote without a body", () => {
      expect(isWebviewMessage({ command: "addNote", anchor: "" })).toBe(false);
    });

    it("7.2b rejects editNote with an empty id", () => {
      expect(isWebviewMessage({ command: "editNote", id: "", body: "text" })).toBe(false);
    });

    it("7.2b rejects editNote with a non-string body", () => {
      expect(isWebviewMessage({ command: "editNote", id: "n1", body: 42 })).toBe(false);
    });

    it("7.2b rejects editNote with a non-string id", () => {
      expect(isWebviewMessage({ command: "editNote", id: 1, body: "text" })).toBe(false);
    });

    it("7.2b rejects moveNote with an empty id", () => {
      expect(isWebviewMessage({ command: "moveNote", id: "", anchor: BOX })).toBe(false);
    });

    it("7.2b rejects moveNote with an anchor of unknown kind", () => {
      expect(isWebviewMessage({ command: "moveNote", id: "n1", anchor: "garbage" })).toBe(false);
    });

    it("7.2b rejects removeNote with an empty id", () => {
      expect(isWebviewMessage({ command: "removeNote", id: "" })).toBe(false);
    });

    it("7.2b rejects removeNote without an id", () => {
      expect(isWebviewMessage({ command: "removeNote" })).toBe(false);
    });
  });

  describe("7.2c createAnnotation creates only highlights", () => {
    it("7.2c rejects createAnnotation with type note", () => {
      expect(isWebviewMessage({ command: "createAnnotation", type: "note", pageNumber: 2, content: "a note" })).toBe(false);
    });

    it("7.2c still accepts createAnnotation with type highlight", () => {
      expect(
        isWebviewMessage({ command: "createAnnotation", type: "highlight", pageNumber: 2, content: "quoted" }),
      ).toBe(true);
    });
  });
});
