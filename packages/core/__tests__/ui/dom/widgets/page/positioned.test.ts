/** @jest-environment jsdom */
// Tests positioned: a control that stays focusable, explains itself and does nothing.
import { positioned } from "../../../../../src/ui/dom/index.js";

describe("positioned", () => {
  it("sets aria-disabled and title and blocks click and Enter", () => {
    const b = document.createElement("button");
    const onClick = jest.fn();
    b.addEventListener("click", onClick);
    positioned(b, "Needs an account");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.title).toBe("Needs an account");
    expect(b.disabled).toBe(false);
    expect(b.classList.contains("ls-positioned")).toBe(true);
    b.click();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    b.dispatchEvent(enter);
    expect(onClick).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
  });
});
