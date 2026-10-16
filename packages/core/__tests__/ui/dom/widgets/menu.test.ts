/**
 * @jest-environment jsdom
 */
// Tests how a menu closes, which roles its items get and how the keyboard moves focus.
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

describe("showMenu checked roles", () => {
  afterEach(() => closeMenu());

  it("gives a checked radio item the menuitemradio role and other checked items the checkbox role", () => {
    const onSelect = (): void => undefined;
    showMenu({ x: 0, y: 0 }, [
      { label: "Box", checked: true, onSelect },
      { label: "Radio", checked: false, radio: true, onSelect },
      { label: "Plain", onSelect },
    ]);
    const roles = [...document.querySelectorAll(".ls-menu-item")].map((b) => b.getAttribute("role"));
    expect(roles).toEqual(["menuitemcheckbox", "menuitemradio", "menuitem"]);
    expect(document.querySelectorAll(".ls-menu-item")[1]!.getAttribute("aria-checked")).toBe("false");
  });
});

describe("showMenu keys", () => {
  afterEach(() => closeMenu());

  it("moves focus to the first enabled item on Home and the last on End", () => {
    const onSelect = (): void => undefined;
    showMenu({ x: 0, y: 0 }, [
      { label: "Off", disabled: true, onSelect },
      { label: "First", onSelect },
      { label: "Middle", onSelect },
      { label: "Last", onSelect },
      { label: "Off too", disabled: true, onSelect },
    ]);
    const press = (key: string): boolean => document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    expect(press("End")).toBe(false);
    expect(document.activeElement?.textContent).toContain("Last");
    expect(press("Home")).toBe(false);
    expect(document.activeElement?.textContent).toContain("First");
  });
});
