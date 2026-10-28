/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests that the Saved flag hides once, two seconds after the last flash.
import { createSavedNotice } from "../../src/options/sections";

describe("saved notice", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("stays shown while flashes keep coming, then hides after the delay", () => {
    const notice = createSavedNotice();
    notice.flash();
    jest.advanceTimersByTime(1500);
    notice.flash();
    jest.advanceTimersByTime(1500);
    expect(notice.element.classList.contains("show")).toBe(true);
    jest.advanceTimersByTime(500);
    expect(notice.element.classList.contains("show")).toBe(false);
  });
});
