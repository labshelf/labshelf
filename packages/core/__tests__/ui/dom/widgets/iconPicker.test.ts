/**
 * @jest-environment jsdom
 */
// Tests the icon picker: search, category filter, the grid, the Default option, Escape and keyboard moves.
import { askIconPicker } from "../../../../src/ui/dom/widgets/iconPicker";
import { TABLER_CATEGORIES, TABLER_ICONS } from "../../../../src/ui/icons";

afterEach(() => { document.body.innerHTML = ""; });

const box = (): HTMLElement => document.querySelector<HTMLElement>(".ls-icon-picker")!;
const icons = (): HTMLButtonElement[] => [...box().querySelectorAll<HTMLButtonElement>("[data-icon]")];
const press = (el: Element, key: string): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };
const search = (): HTMLInputElement => box().querySelector<HTMLInputElement>("input")!;

describe("askIconPicker", () => {
  it("is a labelled modal dialog listing every icon with its label as title, the current one pressed", () => {
    void askIconPicker({ title: "Project icon", current: "atom" });
    expect(box().getAttribute("role")).toBe("dialog");
    expect(box().getAttribute("aria-label")).toBe("Project icon");
    expect(icons()).toHaveLength(TABLER_ICONS.length);
    const atom = icons().find((b) => b.dataset["icon"] === "atom")!;
    expect(atom.getAttribute("title")).toBe("Atom");
    expect(atom.getAttribute("aria-label")).toBe("Atom");
    expect(atom.getAttribute("aria-pressed")).toBe("true");
    expect(atom.querySelector("svg")).not.toBeNull();
    expect(document.activeElement).toBe(search());
  });

  it("filters by the search text and by category", () => {
    void askIconPicker({ title: "Project icon" });
    search().value = "atom";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(icons().map((b) => b.dataset["icon"])).toContain("atom");
    expect(icons().length).toBeLessThan(TABLER_ICONS.length);
    search().value = "";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    const chip = [...box().querySelectorAll<HTMLButtonElement>("[data-category]")].find((b) => b.dataset["category"] === "Physics")!;
    expect(box().querySelectorAll("[data-category]")).toHaveLength(TABLER_CATEGORIES.length + 1);
    chip.click();
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const names = icons().map((b) => b.dataset["icon"]);
    expect(names).toEqual(TABLER_ICONS.filter((i) => i.category === "Physics").map((i) => i.name));
    search().value = "zzzz-nothing";
    search().dispatchEvent(new Event("input", { bubbles: true }));
    expect(icons()).toHaveLength(0);
    expect(box().textContent).toContain("No icons match");
  });

  it("resolves with the clicked icon and closes", async () => {
    const picked = askIconPicker({ title: "Project icon" });
    icons().find((b) => b.dataset["icon"] === "atom")!.click();
    await expect(picked).resolves.toBe("atom");
    expect(document.querySelector(".ls-icon-picker")).toBeNull();
  });

  it("resolves null for the Default option", async () => {
    const picked = askIconPicker({ title: "Project icon", current: "atom" });
    box().querySelector<HTMLButtonElement>("[data-icon-default]")!.click();
    await expect(picked).resolves.toBeNull();
  });

  it("resolves undefined on Escape and on Cancel", async () => {
    const first = askIconPicker({ title: "Project icon" });
    press(search(), "Escape");
    await expect(first).resolves.toBeUndefined();
    expect(document.querySelector(".ls-icon-picker")).toBeNull();
    const second = askIconPicker({ title: "Project icon" });
    box().querySelector<HTMLButtonElement>("[data-icon-cancel]")!.click();
    await expect(second).resolves.toBeUndefined();
  });

  it("moves focus from the search into the grid and through it with the arrow keys", () => {
    void askIconPicker({ title: "Project icon" });
    press(search(), "ArrowDown");
    expect(document.activeElement).toBe(icons()[0]);
    press(icons()[0]!, "ArrowRight");
    expect(document.activeElement).toBe(icons()[1]);
    press(icons()[1]!, "ArrowLeft");
    expect(document.activeElement).toBe(icons()[0]);
    press(icons()[0]!, "End");
    expect(document.activeElement).toBe(icons()[icons().length - 1]);
    press(icons()[icons().length - 1]!, "Home");
    expect(document.activeElement).toBe(icons()[0]);
    press(icons()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(search());
  });
});
