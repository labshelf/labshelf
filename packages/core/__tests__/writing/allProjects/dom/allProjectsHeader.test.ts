/**
 * @jest-environment jsdom
 */
// Tests that the All projects search box reports a query once, after typing pauses.
import { mountAllProjectsHeader } from "../../../../src/writing/allProjects/dom/allProjectsHeader";

describe("all projects header search", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("runs the query handler once with the latest text after rapid input", () => {
    const container = document.createElement("div");
    const onQuery = jest.fn();
    mountAllProjectsHeader(container, { onPlace: jest.fn(), onQuery, onNew: jest.fn(), onEmptyTrash: jest.fn(), onLeaveSearch: jest.fn() });
    const search = container.querySelector<HTMLInputElement>(".ls-all-projects-search")!;
    for (const text of ["a", "ab", "abc"]) { search.value = text; search.dispatchEvent(new Event("input")); }
    expect(onQuery).not.toHaveBeenCalled();
    jest.advanceTimersByTime(80);
    expect(onQuery).toHaveBeenCalledTimes(1);
    expect(onQuery).toHaveBeenCalledWith("abc");
  });
});
