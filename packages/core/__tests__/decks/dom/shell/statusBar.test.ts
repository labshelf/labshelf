/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — the status bar.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { createShellStatus } from "../../../../src/decks/dom/shell/index.js";
import { byLabel, click, hasIcon, q, text } from "./shellHarness.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

describe("A4 status", () => {
  const status = () => {
    const built = createShellStatus();
    document.body.append(built.element);
    return built;
  };
  const nav = (over: Partial<{ previous(): void; next(): void; canPrevious: boolean; canNext: boolean }> = {}) => ({ previous() {}, next() {}, canPrevious: true, canNext: true, ...over });

  it("A4 status is a footer.dw-status with the parts in order", () => {
    const { element } = status();
    expect(element.tagName).toBe("FOOTER");
    expect(element.classList.contains("dw-status")).toBe(true);
    const order = Array.from(element.children).map((c) => ["dw-status-left", "dw-spacer", "dw-hint", "dw-crumb", "dw-status-right"].find((n) => c.classList.contains(n)) ?? c.getAttribute("aria-label"));
    expect(order).toEqual(["Previous slide", "dw-status-left", "Next slide", "dw-spacer", "dw-hint", "dw-crumb", "dw-status-right"]);
  });

  it("A4 status shows the left text", () => {
    const { element, set } = status();
    set({ left: "Slide 2 of 5" });
    expect(text(q(element, ".dw-status-left"))).toBe("Slide 2 of 5");
    set({ left: "Slide 3 of 5" });
    expect(text(q(element, ".dw-status-left"))).toBe("Slide 3 of 5");
  });

  it("A4 status hides the nav buttons without nav", () => {
    const { element, set } = status();
    set({ left: "Poster" });
    expect(byLabel(element, "Previous slide").hidden).toBe(true);
    expect(byLabel(element, "Next slide").hidden).toBe(true);
  });

  it("A4 status shows the nav buttons with nav and hides them again when nav goes", () => {
    const { element, set } = status();
    set({ left: "a", nav: nav() });
    expect(byLabel(element, "Previous slide").hidden).toBe(false);
    expect(byLabel(element, "Next slide").hidden).toBe(false);
    set({ left: "a" });
    expect(byLabel(element, "Previous slide").hidden).toBe(true);
  });

  it("A4 status nav buttons are button.dw-tool with a title", () => {
    const { element } = status();
    for (const label of ["Previous slide", "Next slide"]) {
      const button = byLabel(element, label);
      expect(button.tagName).toBe("BUTTON");
      expect(button.classList.contains("dw-tool")).toBe(true);
      expect(button.title).toBe(label);
    }
  });

  it("A4 status disables nav buttons per canPrevious and canNext", () => {
    const { element, set } = status();
    set({ left: "a", nav: nav({ canPrevious: false, canNext: true }) });
    expect(byLabel(element, "Previous slide").disabled).toBe(true);
    expect(byLabel(element, "Next slide").disabled).toBe(false);
    set({ left: "a", nav: nav({ canPrevious: true, canNext: false }) });
    expect(byLabel(element, "Previous slide").disabled).toBe(false);
    expect(byLabel(element, "Next slide").disabled).toBe(true);
  });

  it("A4 status nav buttons call the current previous and next", () => {
    const first = nav({ previous: jest.fn(), next: jest.fn() });
    const second = nav({ previous: jest.fn(), next: jest.fn() });
    const { element, set } = status();
    set({ left: "a", nav: first });
    set({ left: "b", nav: second });
    click(byLabel(element, "Previous slide"));
    click(byLabel(element, "Next slide"));
    expect(second.previous).toHaveBeenCalledTimes(1);
    expect(second.next).toHaveBeenCalledTimes(1);
    expect(first.previous).not.toHaveBeenCalled();
    expect(first.next).not.toHaveBeenCalled();
  });

  it("A4 status renders the crumb parts with separators between them", () => {
    const { element, set } = status();
    set({ left: "a", crumb: ["Slide 1", "Columns", "Text"] });
    const crumb = q(element, ".dw-crumb");
    const parts = Array.from(crumb.children).filter((c) => !c.classList.contains("dw-crumb-sep")).map((c) => text(c));
    expect(parts).toEqual(["Slide 1", "Columns", "Text"]);
    expect(crumb.querySelectorAll(".dw-crumb-sep").length).toBe(2);
    expect(hasIcon(q(crumb, ".dw-crumb-sep"), "chevron-right")).toBe(true);
  });

  it("A4 status crumb is emptied when a later set has none", () => {
    const { element, set } = status();
    set({ left: "a", crumb: ["Slide 1"] });
    set({ left: "a" });
    expect(text(q(element, ".dw-crumb"))).toBe("");
    expect(q(element, ".dw-crumb").children.length).toBe(0);
  });

  it("A4 status hint is hidden when absent or empty", () => {
    const { element, set } = status();
    set({ left: "a" });
    expect(q(element, ".dw-hint").hidden).toBe(true);
    set({ left: "a", hint: "" });
    expect(q(element, ".dw-hint").hidden).toBe(true);
  });

  it("A4 status shows the hint text and hides it again", () => {
    const { element, set } = status();
    set({ left: "a", hint: "Double-click to edit" });
    expect(q(element, ".dw-hint").hidden).toBe(false);
    expect(text(q(element, ".dw-hint"))).toBe("Double-click to edit");
    set({ left: "a" });
    expect(q(element, ".dw-hint").hidden).toBe(true);
  });

  it("A4 status right side is hidden without state", () => {
    const { element, set } = status();
    set({ left: "a" });
    expect(q(element, ".dw-status-right").hidden).toBe(true);
  });

  it.each([
    ["saved", "Saved", "check"],
    ["dirty", "Unsaved changes", "edit"],
    ["problem", "2 problems", "warning"],
  ] as const)("A4 status state tone %s shows its text and icon", (tone, label, icon) => {
    const { element, set } = status();
    set({ left: "a", state: { tone, text: label } });
    const right = q(element, ".dw-status-right");
    expect(right.hidden).toBe(false);
    expect(right.dataset["state"]).toBe(tone);
    expect(text(right)).toBe(label);
    expect(hasIcon(right, icon)).toBe(true);
  });

  it("A4 status state is hidden again when a later set has none", () => {
    const { element, set } = status();
    set({ left: "a", state: { tone: "saved", text: "Saved" } });
    set({ left: "a" });
    expect(q(element, ".dw-status-right").hidden).toBe(true);
  });
});
