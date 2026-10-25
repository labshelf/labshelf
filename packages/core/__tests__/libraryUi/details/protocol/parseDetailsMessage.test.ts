// Tests the validation of the Details surface's channel envelope and of the message it wraps.
import { parseDetailsMessage } from "../../../../src/libraryUi/details/index";

describe("parseDetailsMessage", () => {
  it("passes a valid envelope on each channel through", () => {
    expect(parseDetailsMessage({ channel: "library", msg: { type: "paper.details", id: "p1" } }))
      .toEqual({ channel: "library", msg: { type: "paper.details", id: "p1" } });
    expect(parseDetailsMessage({ channel: "library", msg: { type: "folder.open", folder: "papers/A" } }))
      .toEqual({ channel: "library", msg: { type: "folder.open", folder: "papers/A" } });
    expect(parseDetailsMessage({ channel: "projects", msg: { type: "detail", id: "x" } }))
      .toEqual({ channel: "projects", msg: { type: "detail", id: "x" } });
  });

  it("returns the inner message as its guard normalises it", () => {
    expect(parseDetailsMessage({ channel: "projects", msg: { type: "rename", id: "x", title: "  T  " } }))
      .toEqual({ channel: "projects", msg: { type: "rename", id: "x", title: "T" } });
  });

  it("rejects a malformed envelope", () => {
    const bad = [
      null, undefined, 3, "library", [], {},
      { channel: "library" },
      { msg: { type: "ready" } },
      { channel: "reader", msg: { type: "ready" } },
      { channel: 1, msg: { type: "ready" } },
      { type: "details.show", target: null },
    ];
    for (const raw of bad) expect(parseDetailsMessage(raw)).toBeNull();
  });

  it("rejects an inner message that the wrapped guard rejects", () => {
    expect(parseDetailsMessage({ channel: "library", msg: { type: "paper.details", id: "" } })).toBeNull();
    expect(parseDetailsMessage({ channel: "library", msg: { type: "folder.open", folder: "papers/../etc" } })).toBeNull();
    expect(parseDetailsMessage({ channel: "projects", msg: { type: "openFile", id: "x", path: "../x" } })).toBeNull();
    // A message is valid only on its own channel.
    expect(parseDetailsMessage({ channel: "projects", msg: { type: "paper.details", id: "p1" } })).toBeNull();
    expect(parseDetailsMessage({ channel: "library", msg: { type: "detail", id: "x" } })).toBeNull();
  });
});
