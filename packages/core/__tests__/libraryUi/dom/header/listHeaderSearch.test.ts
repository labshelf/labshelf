/**
 * @jest-environment jsdom
 */
// Tests that the library search box applies its query once, after typing pauses.
import { mountForTest } from "../mountHarness";

describe("list header search", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sets the query once with the latest text after rapid input", () => {
    const t = mountForTest();
    const search = t.container.querySelector<HTMLInputElement>(".ls-library-search")!;
    for (const text of ["a", "ab", "abc"]) { search.value = text; search.dispatchEvent(new Event("input")); }
    expect(t.lib.store.get().query).toBe("");
    jest.advanceTimersByTime(80);
    expect(t.lib.store.get().query).toBe("abc");
  });
});
