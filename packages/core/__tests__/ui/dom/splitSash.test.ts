/** @jest-environment jsdom */
// Tests the split sash: a drag sets the first card's share between 20% and 80% and reports it once the drag ends.
import { attachSplitSash, SPLIT_WIDTH_PROPERTY } from "../../../src/ui/dom/widgets/splitSash";

function setup(): { host: HTMLElement; sash: HTMLElement; widths: string[] } {
  const host = document.createElement("div");
  host.getBoundingClientRect = () => ({ left: 100, width: 1000, top: 0, height: 0, right: 1100, bottom: 0, x: 100, y: 0, toJSON: () => ({}) });
  const sash = document.createElement("div");
  host.append(sash);
  document.body.append(host);
  const widths: string[] = [];
  attachSplitSash(sash, host, { onEnd: (width) => widths.push(width) });
  return { host, sash, widths };
}

function pointer(target: HTMLElement, type: string, clientX: number): void {
  const event = new MouseEvent(type, { clientX, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("attachSplitSash", () => {
  it("adds the library's grip", () => {
    expect(setup().sash.querySelector(".ls-sash-grip svg")).not.toBeNull();
  });

  it("sets the share from the pointer and reports it when the drag ends", () => {
    const { host, sash, widths } = setup();
    pointer(sash, "pointerdown", 600);
    pointer(sash, "pointermove", 400);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_PROPERTY)).toBe("30%");
    pointer(sash, "pointerup", 400);
    expect(widths).toEqual(["30%"]);
  });

  it("keeps the share between 20% and 80%", () => {
    const { host, sash } = setup();
    pointer(sash, "pointerdown", 600);
    pointer(sash, "pointermove", 120);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_PROPERTY)).toBe("20%");
    pointer(sash, "pointermove", 1090);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_PROPERTY)).toBe("80%");
  });

  it("ignores moves without a drag and reports nothing", () => {
    const { host, sash, widths } = setup();
    pointer(sash, "pointermove", 400);
    pointer(sash, "pointerup", 400);
    expect(host.style.getPropertyValue(SPLIT_WIDTH_PROPERTY)).toBe("");
    expect(widths).toEqual([]);
  });
});
