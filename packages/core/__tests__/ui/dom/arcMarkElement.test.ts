/** @jest-environment jsdom */
// Tests the Arc mark element: its accessible name and the label that sits before the mark.
import { renderArcMarkElement } from "../../../src/ui/dom/index.js";

describe("renderArcMarkElement", () => {
  it("names the mark for assistive technology and takes keyboard focus", () => {
    const mark = renderArcMarkElement("accent", "half", "Reading");
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe("Reading");
    expect(mark.tabIndex).toBe(0);
  });

  it("puts the hidden visual label before the mark", () => {
    const mark = renderArcMarkElement("ok", "full", "Done");
    const [label, svg] = Array.from(mark.children);
    expect(label?.className).toBe("ls-arc-mark-label");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    expect(label?.textContent).toBe("Done");
    expect(svg?.getAttribute("class")).toBe("ls-arc ls-arc-ok");
  });

  it("keeps markup in the label as text", () => {
    const mark = renderArcMarkElement("err", "full", "<b>x</b>");
    expect(mark.querySelector(".ls-arc-mark-label")?.textContent).toBe("<b>x</b>");
    expect(mark.querySelector("b")).toBeNull();
  });
});
