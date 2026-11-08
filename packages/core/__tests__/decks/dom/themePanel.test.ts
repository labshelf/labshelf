/** @jest-environment jsdom */
/** The toolbar popover the size picker uses (the Theme popover is gone, spec 4.1): open and close, Escape and a press outside, keys kept inside. */
import { createToolButton, createToolbarPopover } from "../../../src/decks/dom/toolbarPopover";

afterEach(() => { document.body.innerHTML = ""; });

function mountPopover() {
  const destroy = jest.fn();
  const update = jest.fn();
  const mount = jest.fn((pop: HTMLElement) => { pop.append(Object.assign(document.createElement("input"), { className: "inside" })); return { update, destroy }; });
  const popover = createToolbarPopover("Size", "Change the size", mount);
  document.body.append(popover.element);
  const pop = popover.element.querySelector<HTMLElement>("[role='group']")!;
  return { popover, pop, mount, update, destroy };
}

describe("createToolbarPopover", () => {
  it("opens on the button and closes on it again, destroying the content", () => {
    const { popover, pop, mount, destroy } = mountPopover();
    expect(pop.hidden).toBe(true);
    popover.button.click();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(pop.hidden).toBe(false);
    expect(popover.button.getAttribute("aria-expanded")).toBe("true");
    popover.button.click();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(pop.hidden).toBe(true);
    expect(popover.button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on Escape and on a press outside, and keeps its keys from the editor", () => {
    const { popover, pop } = mountPopover();
    const outer = jest.fn();
    document.body.addEventListener("keydown", outer);
    popover.button.click();
    pop.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    pop.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pop.hidden).toBe(true);
    popover.button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(pop.hidden).toBe(true);
  });

  it("refresh updates open content only", () => {
    const { popover, update } = mountPopover();
    popover.refresh();
    expect(update).not.toHaveBeenCalled();
    popover.button.click();
    popover.refresh();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("createToolButton", () => {
  it("is a labelled ghost button running its action", () => {
    const action = jest.fn();
    const button = createToolButton("Code", "Show the source", action);
    button.click();
    expect(button.getAttribute("aria-label")).toBe("Code");
    expect(button.title).toBe("Show the source");
    expect(action).toHaveBeenCalledTimes(1);
  });
});
