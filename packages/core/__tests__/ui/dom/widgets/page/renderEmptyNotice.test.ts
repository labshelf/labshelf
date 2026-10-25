/** @jest-environment jsdom */
// Tests the renderEmptyNotice widget: text-only caller strings, hint, action and inline variant.
import { renderEmptyNotice } from "../../../../../src/ui/dom/index.js";

describe("renderEmptyNotice", () => {
  it("renders text as text and wires the action", () => {
    const onClick = jest.fn();
    const box = renderEmptyNotice({ text: "<b>x</b>", hint: "h", action: { label: "Add", primary: true, onClick } });
    expect(box.querySelector(".ls-empty-text")!.textContent).toBe("<b>x</b>");
    expect(box.querySelector("b")).toBeNull();
    expect(box.querySelector(".ls-empty-hint")!.textContent).toBe("h");
    box.querySelector<HTMLButtonElement>("button.ls-btn-primary")!.click();
    expect(onClick).toHaveBeenCalled();
  });
  it("marks the inline variant", () => {
    expect(renderEmptyNotice({ text: "t", inline: true }).classList.contains("ls-empty-inline")).toBe(true);
  });
});
