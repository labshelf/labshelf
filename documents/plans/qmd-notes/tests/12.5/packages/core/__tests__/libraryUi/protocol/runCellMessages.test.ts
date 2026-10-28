// Tests that the library UI guards accept the run and cancel messages and drop them whole with a missing or mistyped field.
import { parseUiMessage, parseDetailsMessage } from "../../../src/libraryUi/protocol/index";

const run = { type: "paper.runCell", id: "p1", itemId: "n1", label: "calc", code: "print(1)", requestId: "r1" };
const cancel = { type: "paper.cancelCell", requestId: "r1" };

describe("paper.runCell and paper.cancelCell guards", () => {
  it("12.5a accepts a valid paper.runCell", () => { expect(parseUiMessage(run)).toEqual(run); });
  it("12.5a accepts a valid paper.cancelCell", () => { expect(parseUiMessage(cancel)).toEqual(cancel); });
  it("12.5a accepts both wrapped in the Details envelope", () => {
    expect(parseDetailsMessage({ channel: "library", msg: run })).toEqual({ channel: "library", msg: run });
    expect(parseDetailsMessage({ channel: "library", msg: cancel })).toEqual({ channel: "library", msg: cancel });
  });

  it.each(["id", "itemId", "label", "code", "requestId"])("12.5a drops paper.runCell without %s", (field) => {
    const { [field]: _gone, ...rest } = run as Record<string, unknown>;
    expect(parseUiMessage(rest)).toBeNull();
  });
  it.each(["id", "itemId", "label", "code", "requestId"])("12.5a drops paper.runCell with an empty %s", (field) => {
    expect(parseUiMessage({ ...run, [field]: "" })).toBeNull();
  });
  it.each(["id", "itemId", "label", "code", "requestId"])("12.5a drops paper.runCell with a non-string %s", (field) => {
    expect(parseUiMessage({ ...run, [field]: 7 })).toBeNull();
  });
  it("12.5a drops paper.cancelCell without, with an empty, or with a non-string requestId", () => {
    expect(parseUiMessage({ type: "paper.cancelCell" })).toBeNull();
    expect(parseUiMessage({ type: "paper.cancelCell", requestId: "" })).toBeNull();
    expect(parseUiMessage({ type: "paper.cancelCell", requestId: 3 })).toBeNull();
  });
});
