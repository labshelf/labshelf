/**
 * @jest-environment jsdom
 */
// Tests that a half-typed vim chord expires after the chord timeout.
import { Keyboard } from "../../../../src/reader/dom/navigation/keyboard";
import { CHORD_TIMEOUT_MS } from "../../../../src/reader/navigation/index";

const press = (key: string): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

function setup() {
  const run = jest.fn();
  const ctx = { prefs: { vimKeys: true }, boot: { isMac: false, preview: false } };
  new Keyboard(ctx as never, run);
  return run;
}

describe("keyboard chord prefix", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("completes gg inside the timeout", () => {
    const run = setup();
    press("g");
    jest.advanceTimersByTime(CHORD_TIMEOUT_MS - 1);
    press("g");
    expect(run).toHaveBeenCalledWith("firstPage");
  });

  it("forgets the first g once the timeout has passed", () => {
    const run = setup();
    press("g");
    jest.advanceTimersByTime(CHORD_TIMEOUT_MS);
    press("g");
    expect(run).not.toHaveBeenCalled();
  });
});
