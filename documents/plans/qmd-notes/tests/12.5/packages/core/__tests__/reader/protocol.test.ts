// Tests that the reader guard accepts runCell and cancelCell and drops them whole with a missing or mistyped field.
// The reader's view-to-host messages are discriminated by `command` (the existing WebviewToHost style), so the guard is fed `command`.
import { isWebviewMessage } from "../../src/reader/protocol/index";

const run = { command: "runCell", itemId: "n1", label: "calc", code: "print(1)", requestId: "r1" };
const cancel = { command: "cancelCell", requestId: "r1" };

describe("runCell and cancelCell guards", () => {
  it("12.5a accepts a valid runCell", () => { expect(isWebviewMessage(run)).toBe(true); });
  it("12.5a accepts a valid cancelCell", () => { expect(isWebviewMessage(cancel)).toBe(true); });

  it.each(["itemId", "label", "code", "requestId"])("12.5a drops runCell without %s", (field) => {
    const { [field]: _gone, ...rest } = run as Record<string, unknown>;
    expect(isWebviewMessage(rest)).toBe(false);
  });
  it.each(["itemId", "label", "code", "requestId"])("12.5a drops runCell with an empty %s", (field) => {
    expect(isWebviewMessage({ ...run, [field]: "" })).toBe(false);
  });
  it.each(["itemId", "label", "code", "requestId"])("12.5a drops runCell with a non-string %s", (field) => {
    expect(isWebviewMessage({ ...run, [field]: 7 })).toBe(false);
  });
  it("12.5a drops cancelCell without, with an empty, or with a non-string requestId", () => {
    expect(isWebviewMessage({ command: "cancelCell" })).toBe(false);
    expect(isWebviewMessage({ command: "cancelCell", requestId: "" })).toBe(false);
    expect(isWebviewMessage({ command: "cancelCell", requestId: 3 })).toBe(false);
  });
});
