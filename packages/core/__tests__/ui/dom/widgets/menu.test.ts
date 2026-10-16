/**
 * @jest-environment jsdom
 */
// Tests that a menu reports every way it closes.
import { closeMenu, showMenu } from "../../../../src/ui/dom/widgets/menu";

function open(onClose: () => void, onSelect = (): void => undefined): void {
  showMenu({ x: 0, y: 0 }, [{ label: "Pick", onSelect }], { onClose });
}

describe("showMenu onClose", () => {
  afterEach(() => closeMenu());

  it("runs once when an item is picked, before the item's action", () => {
    const calls: string[] = [];
    open(() => calls.push("close"), () => calls.push("select"));
    document.querySelector<HTMLButtonElement>(".ls-menu-item")!.click();
    closeMenu();
    expect(calls).toEqual(["close", "select"]);
  });

  it("runs on Escape", () => {
    const onClose = jest.fn();
    open(onClose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("runs on an outside click", () => {
    const onClose = jest.fn();
    open(onClose);
    document.querySelector(".ls-scrim")!.dispatchEvent(new MouseEvent("mousedown"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs when another menu replaces it", () => {
    const onClose = jest.fn();
    open(onClose);
    open(jest.fn());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
