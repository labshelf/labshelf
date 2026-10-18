/** Pins the one-replacement fallback between editor and shared text: minimal, and never splitting a CRLF pair. */
import { replacementBetween } from "../../../src/collab/binding/pendingRemoteChanges";

describe("replacementBetween", () => {
  it("replaces only the differing middle", () => {
    expect(replacementBetween("abcdef", "abXYef")).toEqual({ start: 2, end: 4, text: "XY" });
  });

  it("keeps a CRLF pair whole on both edges", () => {
    expect(replacementBetween("a\r\nb", "a\r\r\nb")).toEqual({ start: 1, end: 3, text: "\r\r\n" });
    expect(replacementBetween("x\r\n", "x\n")).toEqual({ start: 1, end: 3, text: "\n" });
  });
});
