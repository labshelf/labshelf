/** @jest-environment jsdom */
// Tests the segmented filter: one pressed option, id reported on click, optional count.
import { renderSegmentedFilter } from "../../../../../src/ui/dom/index.js";

describe("renderSegmentedFilter", () => {
  it("reports the clicked id and moves aria-pressed", () => {
    const onSelect = jest.fn();
    const f = renderSegmentedFilter({ label: "Kind", options: [{ id: "all", label: "All", count: 3 }, { id: "mine", label: "Mine" }], selected: "all", onSelect });
    const [all, mine] = [...f.querySelectorAll("button")];
    expect(f.getAttribute("role")).toBe("group");
    expect(f.getAttribute("aria-label")).toBe("Kind");
    expect(all!.querySelector(".ls-segmented-count")!.textContent).toBe("3");
    expect(mine!.querySelector(".ls-segmented-count")).toBeNull();
    mine!.click();
    expect(onSelect).toHaveBeenCalledWith("mine");
    expect(all!.getAttribute("aria-pressed")).toBe("false");
    expect(mine!.getAttribute("aria-pressed")).toBe("true");
  });
});
