/** @jest-environment jsdom */
// Tests the page tab strip: manual-activation keyboard model, roving tabindex and tabpanel wiring.
import { mountPageTabs } from "../../../../../src/ui/dom/index.js";

function setup() {
  document.body.innerHTML = '<div id="panel"></div>';
  const panel = document.getElementById("panel")!;
  const onSelect = jest.fn();
  const tabs = mountPageTabs(panel, { label: "Space", tabs: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }], selected: "a", onSelect });
  document.body.append(tabs.el);
  const buttons = () => [...tabs.el.querySelectorAll<HTMLElement>('[role="tab"]')];
  const key = (target: HTMLElement, k: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  return { panel, onSelect, tabs, buttons, key };
}

describe("mountPageTabs", () => {
  it("wires the tablist, roving tabindex and tabpanel", () => {
    const { panel, buttons, tabs } = setup();
    expect(tabs.el.getAttribute("role")).toBe("tablist");
    expect(buttons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    expect(buttons()[0]!.getAttribute("aria-controls")).toBe("panel");
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(buttons()[0]!.id);
  });

  it("moves focus with arrows (wrapping), Home and End without selecting", () => {
    const { buttons, key, onSelect } = setup();
    buttons()[0]!.focus();
    key(buttons()[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(buttons()[2]);
    key(buttons()[2]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons()[0]);
    key(buttons()[0]!, "End");
    expect(document.activeElement).toBe(buttons()[2]);
    key(buttons()[2]!, "Home");
    expect(document.activeElement).toBe(buttons()[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects on Enter and click and updates aria state", () => {
    const { buttons, key, onSelect, panel } = setup();
    key(buttons()[1]!, "Enter");
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(buttons().map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(buttons().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(panel.getAttribute("aria-labelledby")).toBe(buttons()[1]!.id);
    buttons()[2]!.click();
    expect(onSelect).toHaveBeenLastCalledWith("c");
  });
});
