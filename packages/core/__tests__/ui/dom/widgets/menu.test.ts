/**
 * @jest-environment jsdom
 */
// Tests how a menu closes, which roles its items get, how the keyboard moves focus and where focus returns.
import { showDialog } from "../../../../src/ui/dom/widgets/dialog";
import { closeMenu, showMenu } from "../../../../src/ui/dom/widgets/menu";
import { askInputBox } from "../../../../src/ui/dom/widgets/quickInput";

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

describe("showMenu focus return", () => {
  let row: HTMLElement;
  beforeEach(() => {
    row = document.createElement("div");
    row.tabIndex = 0;
    document.body.append(row);
    row.focus();
  });
  afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

  const pick = (onSelect: () => void): void => {
    showMenu(row, [{ label: "Share as Link…", onSelect }]);
    document.querySelector<HTMLButtonElement>(".ls-menu-item")!.click();
  };
  const escape = (): void => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); };

  it("returns focus to the invoker on Escape", () => {
    showMenu(row, [{ label: "Pick", onSelect: () => undefined }]);
    expect(document.activeElement).not.toBe(row);
    escape();
    expect(document.activeElement).toBe(row);
  });

  it("returns focus to the invoker when a dialog opened by an item is dismissed", () => {
    pick(() => { void showDialog({ title: "Share", buttons: [{ id: "ok", label: "OK", primary: true }] }); });
    expect(document.activeElement?.textContent).toBe("OK");
    escape();
    expect(document.activeElement).toBe(row);
  });

  it("returns focus to the invoker when an input box opened by an item is dismissed", () => {
    pick(() => { void askInputBox({ title: "Import" }); });
    expect(document.activeElement?.tagName).toBe("INPUT");
    escape();
    expect(document.activeElement).toBe(row);
  });
});

describe("showMenu submenus", () => {
  afterEach(() => closeMenu());

  const key = (name: string): void => { document.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })); };
  const focusedLabel = (): string | undefined => document.activeElement?.querySelector(".ls-menu-label")?.textContent ?? undefined;

  function openWithSubmenu(onBold: () => void): void {
    showMenu({ x: 0, y: 0 }, [
      { label: "Copy", onSelect: () => undefined },
      { label: "Format", submenu: [{ label: "Bold", onSelect: onBold }, { label: "Italic", onSelect: () => undefined }] },
    ]);
  }

  it("opens a submenu with ArrowRight, walks it with the arrows and closes it with ArrowLeft", () => {
    openWithSubmenu(() => undefined);
    const child = document.querySelector<HTMLElement>(".ls-menu-child")!;
    expect(child.hidden).toBe(true);
    key("ArrowDown");
    expect(focusedLabel()).toBe("Format");
    key("ArrowRight");
    expect(child.hidden).toBe(false);
    expect(focusedLabel()).toBe("Bold");
    key("ArrowDown");
    expect(focusedLabel()).toBe("Italic");
    key("ArrowLeft");
    expect(child.hidden).toBe(true);
    expect(focusedLabel()).toBe("Format");
  });

  it("closes only the submenu on Escape inside it, and the whole menu on Escape outside", () => {
    openWithSubmenu(() => undefined);
    key("ArrowDown");
    key("ArrowRight");
    key("Escape");
    expect(document.querySelector<HTMLElement>(".ls-menu-child")!.hidden).toBe(true);
    expect(document.querySelector(".ls-menu")).not.toBeNull();
    key("Escape");
    expect(document.querySelector(".ls-menu")).toBeNull();
  });

  it("runs a submenu item and closes the whole menu", () => {
    const onBold = jest.fn();
    openWithSubmenu(onBold);
    document.querySelector<HTMLButtonElement>(".ls-menu-sub > .ls-menu-item")!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-child .ls-menu-item")][0]!.click();
    expect(onBold).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ls-menu")).toBeNull();
  });
});
