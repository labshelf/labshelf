/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — header, insert bar, status bar, zoom bar, keyboard map and layout.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu, renderIcon } from "../../../../src/ui/dom/index.js";
import {
  bindShellKeys, createInsertBar, createShellHeader, createShellStatus, createZoomBar, mountDeckShell,
  type DeckShellParts, type InsertItem, type ShellHeaderSpec, type ShellKeyActions, type ShellZoomSurface,
} from "../../../../src/decks/dom/shell/index.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

const q = <T extends Element = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`not found: ${selector}`);
  return found;
};
const byLabel = (root: ParentNode, label: string): HTMLButtonElement => q<HTMLButtonElement>(root, `[aria-label="${label}"]`);
const click = (el: Element): void => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
const text = (el: Element): string => (el.textContent ?? "").trim();
const hasIcon = (el: Element, icon: Parameters<typeof renderIcon>[0]): boolean => {
  const holder = document.createElement("div");
  holder.innerHTML = renderIcon(icon);
  return el.innerHTML.includes(holder.innerHTML);
};

// --- header ------------------------------------------------------------------------------------------------------------------------------

describe("A4 header", () => {
  const header = (spec: Partial<ShellHeaderSpec> = {}) => {
    const built = createShellHeader({ title: "Talk", badge: "LaTeX", ...spec });
    document.body.append(built.element);
    return built;
  };

  it("A4 header is a header.dw-header with the title and the badge", () => {
    const { element } = header({ title: "My talk", badge: "Typst" });
    expect(element.tagName).toBe("HEADER");
    expect(element.classList.contains("dw-header")).toBe(true);
    expect(text(q(element, ".dw-title"))).toBe("My talk");
    expect(text(q(element, ".dw-badge"))).toBe("Typst");
    expect(element.querySelector(".dw-spacer")).not.toBeNull();
  });

  it("A4 header puts title, badge, spacer, saved, build, export and show in that order", () => {
    const { element } = header({ saved: true, build: { run() {}, showProblems() {} }, exports: [{ label: "PDF", icon: "download", run() {} }], show: { label: "Present", icon: "play", run() {} } });
    const order = Array.from(element.children).map((child) => ["dw-title", "dw-badge", "dw-spacer", "dw-saved", "dw-build", "dw-header-button"].find((c) => child.classList.contains(c)));
    expect(order).toEqual(["dw-title", "dw-badge", "dw-spacer", "dw-saved", "dw-build", "dw-header-button", "dw-header-button"]);
    const buttons = element.querySelectorAll(".dw-header-button");
    expect(buttons[0]?.getAttribute("aria-label")).toBe("Export PDF");
    expect(buttons[1]?.classList.contains("dw-primary")).toBe(true);
  });

  it("A4 header has no mode tabs without modes", () => {
    expect(header().element.querySelector(".dw-modes")).toBeNull();
  });

  it("A4 header has no mode tabs with a single mode", () => {
    expect(header({ modes: ["visual"] }).element.querySelector(".dw-modes")).toBeNull();
  });

  it("A4 header shows one tab per mode when there are two or more", () => {
    const { element } = header({ modes: ["visual", "code"] });
    const tabs = q(element, ".dw-modes");
    expect(tabs.getAttribute("role")).toBe("tablist");
    expect(tabs.getAttribute("aria-label")).toBe("Mode");
    const buttons = Array.from(tabs.querySelectorAll<HTMLButtonElement>("button.dw-mode"));
    expect(buttons.map((b) => b.dataset["mode"])).toEqual(["visual", "code"]);
    expect(buttons.every((b) => b.getAttribute("role") === "tab")).toBe(true);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Visual", "Code"]);
    expect(buttons.map((b) => text(b))).toEqual(["Visual", "Code"]);
  });

  it("A4 header mode tabs are the first child and carry the icons eye, panel-right and code", () => {
    const { element } = header({ modes: ["visual", "split", "code"] });
    expect(element.firstElementChild?.classList.contains("dw-modes")).toBe(true);
    const [visual, split, code] = Array.from(element.querySelectorAll<HTMLButtonElement>(".dw-mode"));
    expect(hasIcon(visual!, "eye")).toBe(true);
    expect(hasIcon(split!, "panel-right")).toBe(true);
    expect(hasIcon(code!, "code")).toBe(true);
    expect(split!.getAttribute("aria-label")).toBe("Split");
  });

  it("A4 header setMode selects exactly one tab with aria-selected", () => {
    const { element, setMode } = header({ modes: ["visual", "split", "code"] });
    const selected = (): Array<string | null> => Array.from(element.querySelectorAll<HTMLButtonElement>(".dw-mode")).map((b) => b.getAttribute("aria-selected"));
    setMode("split");
    expect(selected()).toEqual(["false", "true", "false"]);
    setMode("code");
    expect(selected()).toEqual(["false", "false", "true"]);
  });

  it("A4 header a tab click calls onMode with that mode", () => {
    const onMode = jest.fn();
    const { element } = header({ modes: ["visual", "split", "code"], onMode });
    click(q(element, '.dw-mode[data-mode="code"]'));
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode).toHaveBeenCalledWith("code");
  });

  it("A4 header has no build button without spec.build", () => {
    expect(header().element.querySelector(".dw-build")).toBeNull();
  });

  it("A4 header build button starts at data-state none", () => {
    expect(q(header({ build: { run() {}, showProblems() {} } }).element, ".dw-build").dataset["state"]).toBe("none");
  });

  it.each([
    ["none", 0, "Build", "refresh"],
    ["building", 0, "Compiling…", "loader"],
    ["succeeded", 0, "Updated", "check"],
    ["failed", 3, "Errors (3)", "warning"],
    ["failed", 0, "Build failed", "warning"],
  ] as const)("A4 header build state %s with %d errors reads %s", (state, errors, label, icon) => {
    const { element, setBuild } = header({ build: { run() {}, showProblems() {} } });
    setBuild({ state, errors });
    const button = q(element, ".dw-build");
    expect(button.dataset["state"]).toBe(state);
    expect(text(button)).toBe(label);
    expect(hasIcon(button, icon)).toBe(true);
  });

  it("A4 header build button click runs the build when idle or succeeded", () => {
    const run = jest.fn();
    const showProblems = jest.fn();
    const { element, setBuild } = header({ build: { run, showProblems } });
    setBuild({ state: "none", errors: 0 });
    click(q(element, ".dw-build"));
    setBuild({ state: "succeeded", errors: 0 });
    click(q(element, ".dw-build"));
    expect(run).toHaveBeenCalledTimes(2);
    expect(showProblems).not.toHaveBeenCalled();
  });

  it("A4 header build button click shows the problems when the build failed", () => {
    const run = jest.fn();
    const showProblems = jest.fn();
    const { element, setBuild } = header({ build: { run, showProblems } });
    setBuild({ state: "failed", errors: 2 });
    click(q(element, ".dw-build"));
    expect(showProblems).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("A4 header build button click does nothing while building", () => {
    const run = jest.fn();
    const showProblems = jest.fn();
    const { element, setBuild } = header({ build: { run, showProblems } });
    setBuild({ state: "building", errors: 0 });
    click(q(element, ".dw-build"));
    expect(run).not.toHaveBeenCalled();
    expect(showProblems).not.toHaveBeenCalled();
  });

  it("A4 header has no saved indicator when spec.saved is undefined", () => {
    expect(header().element.querySelector(".dw-saved")).toBeNull();
  });

  it("A4 header saved indicator reads Saved when saved", () => {
    const indicator = q(header({ saved: true }).element, "span.dw-check.dw-saved");
    expect(indicator.dataset["saved"]).toBe("true");
    expect(text(indicator)).toBe("Saved");
  });

  it("A4 header saved indicator reads Unsaved changes when not saved", () => {
    const indicator = q(header({ saved: false }).element, ".dw-saved");
    expect(indicator.dataset["saved"]).toBe("false");
    expect(text(indicator)).toBe("Unsaved changes");
  });

  it("A4 header setSaved switches the saved indicator", () => {
    const { element, setSaved } = header({ saved: true });
    setSaved(false);
    expect(q(element, ".dw-saved").dataset["saved"]).toBe("false");
    expect(text(q(element, ".dw-saved"))).toBe("Unsaved changes");
    setSaved(true);
    expect(q(element, ".dw-saved").dataset["saved"]).toBe("true");
    expect(text(q(element, ".dw-saved"))).toBe("Saved");
  });

  it("A4 header with no exports has no export control", () => {
    const { element } = header({ exports: [] });
    expect(Array.from(element.querySelectorAll("button")).some((b) => (b.getAttribute("aria-label") ?? "").startsWith("Export"))).toBe(false);
  });

  it("A4 header with one export has a button labelled Export <label> that runs it", () => {
    const run = jest.fn();
    const { element } = header({ exports: [{ label: "PDF", icon: "download", run }] });
    const button = byLabel(element, "Export PDF");
    expect(button.classList.contains("dw-header-button")).toBe(true);
    expect(hasIcon(button, "download")).toBe(true);
    expect(button.title).not.toBe("");
    click(button);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("A4 header with two exports has an Export button that opens a menu of the entries", () => {
    const pdf = jest.fn();
    const html = jest.fn();
    const { element } = header({ exports: [{ label: "PDF", icon: "download", run: pdf }, { label: "HTML", icon: "code", run: html }] });
    const button = byLabel(element, "Export");
    expect(button.classList.contains("dw-header-button")).toBe(true);
    expect(document.querySelector(".ls-menu")).toBeNull();
    click(button);
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>(".ls-menu-item"));
    expect(items.map((i) => text(i))).toEqual(["PDF", "HTML"]);
    click(items[1]!);
    expect(html).toHaveBeenCalledTimes(1);
    expect(pdf).not.toHaveBeenCalled();
  });

  it("A4 header with several exports has no per-format Export buttons", () => {
    const { element } = header({ exports: [{ label: "PDF", icon: "download", run() {} }, { label: "HTML", icon: "code", run() {} }] });
    expect(element.querySelector('[aria-label="Export PDF"]')).toBeNull();
    expect(element.querySelector('[aria-label="Export HTML"]')).toBeNull();
  });

  it("A4 header has no show button without spec.show", () => {
    expect(header().element.querySelector(".dw-primary")).toBeNull();
  });

  it("A4 header show button shows its label and icon and calls its run", () => {
    const run = jest.fn();
    const { element } = header({ show: { label: "Present", icon: "play", run } });
    const button = q(element, "button.dw-header-button.dw-primary");
    expect(text(button)).toBe("Present");
    expect(button.getAttribute("aria-label")).toBe("Present");
    expect(hasIcon(button, "play")).toBe(true);
    click(button);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("A4 header buttons carry a title and keep editor focus on mousedown", () => {
    const { element, setBuild } = header({
      modes: ["visual", "code"], build: { run() {}, showProblems() {} }, exports: [{ label: "PDF", icon: "download", run() {} }], show: { label: "Present", icon: "play", run() {} },
    });
    setBuild({ state: "none", errors: 0 });
    const buttons = Array.from(element.querySelectorAll<HTMLButtonElement>("button")).filter((b) => !b.classList.contains("dw-build"));
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label")).toBe(text(button));
      expect(button.title).not.toBe("");
      const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      button.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    }
  });
});

// --- insert bar --------------------------------------------------------------------------------------------------------------------------

describe("A4 insert bar", () => {
  const item = (label: string, extra: Partial<InsertItem> = {}): InsertItem => ({ icon: "plus", label, run() {}, ...extra });

  it("A4 insert bar is a toolbar labelled Insert", () => {
    const { element } = createInsertBar([[item("Text")]]);
    expect(element.getAttribute("role")).toBe("toolbar");
    expect(element.getAttribute("aria-label")).toBe("Insert");
  });

  it("A4 insert bar has one group per array and one button per item", () => {
    const { element } = createInsertBar([[item("Text"), item("Image")], [item("Table")]]);
    const groups = Array.from(element.querySelectorAll(".dw-insert-group"));
    expect(groups.length).toBe(2);
    expect(Array.from(groups[0]!.querySelectorAll("button.dw-insert")).map((b) => text(b))).toEqual(["Text", "Image"]);
    expect(Array.from(groups[1]!.querySelectorAll("button.dw-insert")).map((b) => text(b))).toEqual(["Table"]);
  });

  it("A4 insert bar buttons carry aria-label, title and the item's icon", () => {
    const { element } = createInsertBar([[item("Text", { icon: "target" })]]);
    const button = q(element, "button.dw-insert");
    expect(button.getAttribute("aria-label")).toBe("Text");
    expect(button.title).toBe("Text");
    expect(hasIcon(button, "target")).toBe(true);
  });

  it("A4 insert bar keeps editor focus on mousedown", () => {
    const { element } = createInsertBar([[item("Text")]]);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    q(element, "button.dw-insert").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("A4 insert bar click on a run item calls run", () => {
    const run = jest.fn();
    const { element } = createInsertBar([[item("Text", { run })]]);
    click(q(element, "button.dw-insert"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("A4 insert bar menu item gets a chevron and a plain item does not", () => {
    const { element } = createInsertBar([[item("Plain"), item("More", { menu: () => [] })]]);
    const [plain, more] = Array.from(element.querySelectorAll<HTMLButtonElement>("button.dw-insert"));
    expect(hasIcon(plain!, "chevron-down")).toBe(false);
    expect(hasIcon(more!, "chevron-down")).toBe(true);
  });

  it("A4 insert bar menu item builds its menu when pressed and shows its entries", () => {
    const onSelect = jest.fn();
    const menu = jest.fn(() => [{ label: "Two columns", onSelect }, { label: "Three columns", onSelect() {} }]);
    const { element } = createInsertBar([[item("Layout", { menu })]]);
    expect(menu).not.toHaveBeenCalled();
    click(q(element, "button.dw-insert"));
    expect(menu).toHaveBeenCalledTimes(1);
    const entries = Array.from(document.querySelectorAll<HTMLButtonElement>(".ls-menu-item"));
    expect(entries.map((e) => text(e))).toEqual(["Two columns", "Three columns"]);
    click(entries[0]!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("A4 insert bar menu item does not call run", () => {
    const run = jest.fn();
    const { element } = createInsertBar([[{ icon: "plus", label: "Layout", run, menu: () => [] }]]);
    click(q(element, "button.dw-insert"));
    expect(run).not.toHaveBeenCalled();
  });

  it("A4 insert bar puts end items after a spacer", () => {
    const extra = document.createElement("span");
    extra.className = "extra";
    const { element } = createInsertBar([[item("Text")]], [extra]);
    const children = Array.from(element.children);
    const spacer = children.findIndex((c) => c.classList.contains("dw-spacer"));
    expect(spacer).toBeGreaterThan(0);
    expect(children.indexOf(extra)).toBeGreaterThan(spacer);
    expect(children[children.length - 1]).toBe(extra);
  });

  it("A4 insert bar has a spacer and no end items by default", () => {
    const { element } = createInsertBar([[item("Text")]]);
    expect(element.querySelector(".dw-spacer")).not.toBeNull();
  });

  it("A4 insert bar refresh disables a button with its reason as title and re-enables it", () => {
    let reason: string | undefined = "Select a slide first";
    const { element, refresh } = createInsertBar([[item("Text", { disabled: () => reason }), item("Image")]]);
    const [text1, image] = Array.from(element.querySelectorAll<HTMLButtonElement>("button.dw-insert"));
    refresh();
    expect(text1!.disabled).toBe(true);
    expect(text1!.title).toBe("Select a slide first");
    expect(image!.disabled).toBe(false);
    expect(image!.title).toBe("Image");
    reason = undefined;
    refresh();
    expect(text1!.disabled).toBe(false);
    expect(text1!.title).toBe("Text");
  });

  it("A4 insert bar is still exported from the workspace index module", async () => {
    const workspace = await import("../../../../src/decks/dom/workspace/index.js");
    const shell = await import("../../../../src/decks/dom/shell/index.js");
    expect(workspace.createInsertBar).toBe(shell.createInsertBar);
  });
});

// --- status bar --------------------------------------------------------------------------------------------------------------------------

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

// --- zoom bar ----------------------------------------------------------------------------------------------------------------------------

describe("A4 zoom bar", () => {
  interface Fake extends ShellZoomSurface { percentValue: number; fitValue: boolean; setZoom: jest.Mock; setTool: jest.Mock }
  const surface = (percent = 100, fit = false): Fake => {
    const fake: Fake = {
      percentValue: percent, fitValue: fit,
      percent: () => fake.percentValue,
      isFit: () => fake.fitValue,
      setZoom: jest.fn((next: number | "fit") => { if (next === "fit") { fake.fitValue = true; fake.percentValue = 62; } else { fake.fitValue = false; fake.percentValue = next; } }),
      setTool: jest.fn(),
    };
    return fake;
  };
  const bar = (fake: Fake, options?: Parameters<typeof createZoomBar>[1]) => {
    const built = createZoomBar(fake, options);
    document.body.append(built.element);
    built.render();
    return built;
  };
  const label = (b: { element: HTMLElement }): string => text(q(b.element, ".dw-zoom-label"));

  it("A4 zoom bar is a toolbar labelled Zoom with its tools, rule and fit", () => {
    const { element } = bar(surface());
    expect(element.classList.contains("dw-zoombar")).toBe(true);
    expect(element.getAttribute("role")).toBe("toolbar");
    expect(element.getAttribute("aria-label")).toBe("Zoom");
    for (const name of ["Select", "Hand", "Zoom out", "Zoom in", "Fit"]) expect(byLabel(element, name).tagName).toBe("BUTTON");
    expect(element.querySelector(".dw-zoombar-rule")).not.toBeNull();
    expect(element.querySelector(".dw-zoom-label")).not.toBeNull();
  });

  it("A4 zoom bar tool buttons are button.dw-tool with titles and icons", () => {
    const { element } = bar(surface());
    const select = byLabel(element, "Select");
    const hand = byLabel(element, "Hand");
    expect(select.classList.contains("dw-tool")).toBe(true);
    expect(hand.classList.contains("dw-tool")).toBe(true);
    expect(select.title).toBe("Select (V)");
    expect(hand.title).toBe("Hand (H, or hold Space)");
    expect(hasIcon(select, "target")).toBe(true);
    expect(hasIcon(hand, "move")).toBe(true);
    expect(hasIcon(byLabel(element, "Zoom out"), "minus")).toBe(true);
    expect(hasIcon(byLabel(element, "Zoom in"), "plus")).toBe(true);
  });

  it("A4 zoom bar fit button reads Fit", () => {
    const fit = q(bar(surface()).element, "button.dw-zoom-fit");
    expect(text(fit)).toBe("Fit");
    expect(fit.getAttribute("aria-label")).toBe("Fit");
  });

  it.each([
    [100, 125], [125, 150], [124.9, 125], [10, 25], [9, 10], [67, 75], [300, 400], [399, 400], [60, 67],
  ])("A4 zoom bar zoom in from %d percent goes to %d", (from, to) => {
    const fake = surface(from);
    bar(fake).zoomIn();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith(to);
  });

  it.each([
    [100, 75], [125, 100], [125.1, 125], [400, 300], [401, 400], [25, 10], [11, 10], [60, 50], [34, 33],
  ])("A4 zoom bar zoom out from %d percent goes to %d", (from, to) => {
    const fake = surface(from);
    bar(fake).zoomOut();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith(to);
  });

  it("A4 zoom bar zoom in clamps at 400", () => {
    const fake = surface(400);
    bar(fake).zoomIn();
    expect(fake.setZoom.mock.calls.every(([next]) => next === 400)).toBe(true);
    expect(fake.percentValue).toBe(400);
  });

  it("A4 zoom bar zoom out clamps at 10", () => {
    const fake = surface(10);
    bar(fake).zoomOut();
    expect(fake.setZoom.mock.calls.every(([next]) => next === 10)).toBe(true);
    expect(fake.percentValue).toBe(10);
  });

  it("A4 zoom bar walks the steps one at a time on repeated zoom in", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    for (let i = 0; i < 12; i++) zoom.zoomIn();
    const walked = Array.from(new Set(fake.setZoom.mock.calls.map(([next]) => next)));
    expect(walked).toEqual([125, 150, 200, 300, 400]);
  });

  it("A4 zoom bar buttons Zoom in and Zoom out act like the methods", () => {
    const fake = surface(100);
    const { element } = bar(fake);
    click(byLabel(element, "Zoom in"));
    expect(fake.setZoom).toHaveBeenLastCalledWith(125);
    click(byLabel(element, "Zoom out"));
    expect(fake.setZoom).toHaveBeenLastCalledWith(100);
  });

  it("A4 zoom bar Fit button and fit() call setZoom with fit", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    click(q(zoom.element, "button.dw-zoom-fit"));
    expect(fake.setZoom).toHaveBeenLastCalledWith("fit");
    fake.setZoom.mockClear();
    zoom.fit();
    expect(fake.setZoom).toHaveBeenCalledTimes(1);
    expect(fake.setZoom).toHaveBeenCalledWith("fit");
  });

  it("A4 zoom bar label reads N% when not fit, rounded", () => {
    const zoom = bar(surface(99.6));
    expect(label(zoom)).toBe("100%");
  });

  it("A4 zoom bar label reads Fit · N% when fit", () => {
    const zoom = bar(surface(87.2, true));
    expect(label(zoom)).toBe("Fit · 87%");
  });

  it("A4 zoom bar render follows the surface", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    expect(label(zoom)).toBe("100%");
    fake.percentValue = 50;
    zoom.render();
    expect(label(zoom)).toBe("50%");
  });

  it("A4 zoom bar every zoom change re-renders the label", () => {
    const fake = surface(100);
    const zoom = bar(fake);
    zoom.zoomIn();
    expect(label(zoom)).toBe("125%");
    zoom.zoomOut();
    zoom.zoomOut();
    expect(label(zoom)).toBe("75%");
    zoom.fit();
    expect(label(zoom)).toBe("Fit · 62%");
    click(byLabel(zoom.element, "Zoom in"));
    expect(label(zoom)).toBe("67%");
  });

  it("A4 zoom bar starts with the select tool", () => {
    expect(bar(surface()).tool()).toBe("select");
  });

  it("A4 zoom bar clicking Hand calls setTool and sets aria-pressed", () => {
    const fake = surface();
    const zoom = bar(fake);
    click(byLabel(zoom.element, "Hand"));
    expect(fake.setTool).toHaveBeenCalledWith("hand");
    expect(zoom.tool()).toBe("hand");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 zoom bar clicking Select after Hand goes back", () => {
    const fake = surface();
    const zoom = bar(fake);
    click(byLabel(zoom.element, "Hand"));
    click(byLabel(zoom.element, "Select"));
    expect(fake.setTool).toHaveBeenLastCalledWith("select");
    expect(zoom.tool()).toBe("select");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 zoom bar setTool calls the surface and updates the buttons", () => {
    const fake = surface();
    const zoom = bar(fake);
    zoom.setTool("hand");
    expect(fake.setTool).toHaveBeenCalledWith("hand");
    expect(zoom.tool()).toBe("hand");
    expect(byLabel(zoom.element, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(byLabel(zoom.element, "Select").getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 zoom bar has no Guides button without the guides option", () => {
    expect(bar(surface()).element.querySelector('[aria-label="Guides"]')).toBeNull();
  });

  it("A4 zoom bar Guides button reflects on() in aria-pressed", () => {
    const off = bar(surface(), { guides: { on: () => false, toggle() {} } });
    const on = bar(surface(), { guides: { on: () => true, toggle() {} } });
    expect(byLabel(off.element, "Guides").getAttribute("aria-pressed")).toBe("false");
    expect(byLabel(on.element, "Guides").getAttribute("aria-pressed")).toBe("true");
    expect(hasIcon(byLabel(on.element, "Guides"), "grid")).toBe(true);
  });

  it("A4 zoom bar Guides click toggles then re-renders the pressed state", () => {
    let value = false;
    const toggle = jest.fn(() => { value = !value; });
    const zoom = bar(surface(), { guides: { on: () => value, toggle } });
    click(byLabel(zoom.element, "Guides"));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(byLabel(zoom.element, "Guides").getAttribute("aria-pressed")).toBe("true");
    click(byLabel(zoom.element, "Guides"));
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(byLabel(zoom.element, "Guides").getAttribute("aria-pressed")).toBe("false");
  });
});

// --- keys --------------------------------------------------------------------------------------------------------------------------------

describe("A4 keys", () => {
  const setPlatform = (platform: string): void => {
    Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
    Object.defineProperty(window.navigator, "userAgent", { value: `Mozilla/5.0 (${platform})`, configurable: true });
  };
  const unbinders: Array<() => void> = [];
  beforeEach(() => setPlatform("Linux x86_64"));
  afterEach(() => { while (unbinders.length) unbinders.pop()!(); });

  const actionsOf = (): { [K in keyof ShellKeyActions]-?: jest.Mock } => ({
    undo: jest.fn(), redo: jest.fn(), zoomIn: jest.fn(), zoomOut: jest.fn(), fit: jest.fn(), setTool: jest.fn(), holdHand: jest.fn(),
    previous: jest.fn(), next: jest.fn(), deleteSelection: jest.fn(), clearSelection: jest.fn(), duplicate: jest.fn(),
  });
  const mount = (actions: ShellKeyActions) => {
    const root = document.createElement("div");
    const input = document.createElement("input");
    root.append(input);
    document.body.append(root);
    const unbind = bindShellKeys(root, actions);
    unbinders.push(unbind);
    return { root, unbind };
  };
  const press = (target: Element | Window, init: KeyboardEventInit & { key: string }, type: "keydown" | "keyup" = "keydown"): KeyboardEvent => {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  const ctrl = { ctrlKey: true };
  const table: ReadonlyArray<[string, KeyboardEventInit & { key: string }, keyof ShellKeyActions, unknown[]]> = [
    ["Mod+Z", { key: "z", ...ctrl }, "undo", []],
    ["Mod+Shift+Z", { key: "Z", shiftKey: true, ...ctrl }, "redo", []],
    ["Mod+Y", { key: "y", ...ctrl }, "redo", []],
    ["Mod+=", { key: "=", ...ctrl }, "zoomIn", []],
    ["Mod++", { key: "+", shiftKey: true, ...ctrl }, "zoomIn", []],
    ["Mod+-", { key: "-", ...ctrl }, "zoomOut", []],
    ["Mod+0", { key: "0", ...ctrl }, "fit", []],
    ["Mod+D", { key: "d", ...ctrl }, "duplicate", []],
    ["V", { key: "v" }, "setTool", ["select"]],
    ["H", { key: "h" }, "setTool", ["hand"]],
    ["PageDown", { key: "PageDown" }, "next", []],
    ["PageUp", { key: "PageUp" }, "previous", []],
    ["Delete", { key: "Delete" }, "deleteSelection", []],
    ["Backspace", { key: "Backspace" }, "deleteSelection", []],
    ["Escape", { key: "Escape" }, "clearSelection", []],
  ];

  it.each(table)("A4 keys %s calls its action and is prevented", (_name, init, action, args) => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const event = press(root, init);
    expect(actions[action]).toHaveBeenCalledTimes(1);
    expect(actions[action]).toHaveBeenCalledWith(...args);
    expect(event.defaultPrevented).toBe(true);
    for (const [other, fn] of Object.entries(actions)) if (other !== action) expect(fn).not.toHaveBeenCalled();
  });

  it.each(table)("A4 keys %s with no action is left alone", (_name, init) => {
    const { root } = mount({});
    expect(press(root, init).defaultPrevented).toBe(false);
  });

  it("A4 keys only the given actions are handled", () => {
    const undo = jest.fn();
    const { root } = mount({ undo });
    expect(press(root, { key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press(root, { key: "Delete" }).defaultPrevented).toBe(false);
    expect(press(root, { key: "Escape" }).defaultPrevented).toBe(false);
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("A4 keys Mod+Z needs ctrl on a non-Apple platform and ignores meta", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    expect(press(root, { key: "z", metaKey: true }).defaultPrevented).toBe(false);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("A4 keys Mod is meta on Apple platforms and ctrl is ignored", () => {
    setPlatform("MacIntel");
    const actions = actionsOf();
    const { root } = mount(actions);
    expect(press(root, { key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(actions.undo).not.toHaveBeenCalled();
    const event = press(root, { key: "z", metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });

  it("A4 keys Mod+Shift+Z is redo and not undo", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    press(root, { key: "Z", shiftKey: true, ctrlKey: true });
    expect(actions.redo).toHaveBeenCalledTimes(1);
    expect(actions.undo).not.toHaveBeenCalled();
  });

  it("A4 keys Space keydown holds the hand and Space keyup on the window releases it", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const down = press(root, { key: " ", code: "Space" });
    expect(actions.holdHand).toHaveBeenCalledTimes(1);
    expect(actions.holdHand).toHaveBeenLastCalledWith(true);
    expect(down.defaultPrevented).toBe(true);
    press(window, { key: " ", code: "Space" }, "keyup");
    expect(actions.holdHand).toHaveBeenCalledTimes(2);
    expect(actions.holdHand).toHaveBeenLastCalledWith(false);
  });

  it("A4 keys Space without holdHand is left alone", () => {
    const { root } = mount({});
    expect(press(root, { key: " ", code: "Space" }).defaultPrevented).toBe(false);
  });

  it("A4 keys Space keyup is heard even when the root never sees it", () => {
    const actions = actionsOf();
    mount(actions);
    press(document.body, { key: " ", code: "Space" }, "keyup");
    expect(actions.holdHand).toHaveBeenCalledWith(false);
  });

  it.each([
    ["input", () => document.createElement("input")],
    ["textarea", () => document.createElement("textarea")],
    ["select", () => document.createElement("select")],
    ["a child of .cm-editor", () => { const editor = document.createElement("div"); editor.className = "cm-editor"; const line = document.createElement("div"); editor.append(line); return line; }],
    ["a [contenteditable] element", () => { const el = document.createElement("div"); el.setAttribute("contenteditable", "true"); return el; }],
    ["a child of [contenteditable]", () => { const el = document.createElement("div"); el.setAttribute("contenteditable", "true"); const span = document.createElement("span"); el.append(span); return span; }],
  ])("A4 keys inside %s are ignored", (_name, make) => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const target = make();
    root.append(target.closest("div") && target.parentElement && target.parentElement !== root ? target.parentElement : target);
    for (const init of [{ key: "Delete" }, { key: "z", ctrlKey: true }, { key: "v" }, { key: "PageDown" }, { key: "Escape" }, { key: " ", code: "Space" }]) {
      const event = press(target, init);
      expect(event.defaultPrevented).toBe(false);
    }
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("A4 keys already prevented events are ignored", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const child = document.createElement("button");
    child.addEventListener("keydown", (event) => event.preventDefault());
    root.append(child);
    press(child, { key: "Delete" });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });

  it("A4 keys a key on a plain element inside the root is handled", () => {
    const actions = actionsOf();
    const { root } = mount(actions);
    const child = document.createElement("div");
    root.append(child);
    press(child, { key: "Delete" });
    expect(actions.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it("A4 keys events outside the root are not handled", () => {
    const actions = actionsOf();
    mount(actions);
    const outside = document.createElement("div");
    document.body.append(outside);
    press(outside, { key: "Delete" });
    expect(actions.deleteSelection).not.toHaveBeenCalled();
  });

  it("A4 keys unbind stops keydown and keyup handling", () => {
    const actions = actionsOf();
    const { root, unbind } = mount(actions);
    unbind();
    const event = press(root, { key: "Delete" });
    press(root, { key: "z", ctrlKey: true });
    press(root, { key: " ", code: "Space" });
    press(window, { key: " ", code: "Space" }, "keyup");
    expect(event.defaultPrevented).toBe(false);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
});

// --- layout ------------------------------------------------------------------------------------------------------------------------------

describe("A4 layout", () => {
  const el = (name: string, tag = "div"): HTMLElement => {
    const made = document.createElement(tag);
    made.dataset["part"] = name;
    return made;
  };
  const makeParts = (over: Partial<DeckShellParts> = {}): DeckShellParts => ({
    format: "latex", kind: "talk",
    header: el("header", "header"), insert: el("insert"), left: el("left"), stage: el("stage"), zoom: el("zoom"), props: el("props"), status: el("status", "footer"),
    ...over,
  });
  const mount = (over: Partial<DeckShellParts> = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const parts = makeParts(over);
    const shell = mountDeckShell(host, parts);
    return { host, parts, shell };
  };
  const parts = (container: Element): Array<string | undefined> => Array.from(container.children).map((c) => (c as HTMLElement).dataset["part"] ?? c.className);

  it("A4 layout appends div.dw to the host and returns it as root", () => {
    const { host, shell } = mount();
    expect(shell.root.tagName).toBe("DIV");
    expect(shell.root.classList.contains("dw")).toBe(true);
    expect(shell.root.parentElement).toBe(host);
  });

  it("A4 layout carries data-format, data-kind and data-mode visual", () => {
    const { shell } = mount({ format: "typst", kind: "poster" });
    expect(shell.root.dataset["format"]).toBe("typst");
    expect(shell.root.dataset["kind"]).toBe("poster");
    expect(shell.root.dataset["mode"]).toBe("visual");
  });

  it("A4 layout orders header, insert, body, status", () => {
    const { shell } = mount();
    expect(parts(shell.root)).toEqual(["header", "insert", "dw-body", "status"]);
  });

  it("A4 layout without a code part has left, stage column and props in the body, and no code pane or divider", () => {
    const { shell } = mount();
    const body = q(shell.root, ".dw-body");
    expect(parts(body)).toEqual(["left", "dw-stage-column", "props"]);
    expect(shell.root.querySelector(".dw-code")).toBeNull();
    expect(shell.root.querySelector(".dw-divider")).toBeNull();
  });

  it("A4 layout with a code part has left, code pane, stage column and props in the body", () => {
    const { shell } = mount({ code: el("code") });
    expect(parts(q(shell.root, ".dw-body"))).toEqual(["left", "dw-code", "dw-stage-column", "props"]);
  });

  it("A4 layout code pane holds the code part and then a resize divider", () => {
    const { shell } = mount({ code: el("code") });
    const pane = q(shell.root, ".dw-code");
    expect(parts(pane)).toEqual(["code", "dw-divider"]);
    const divider = q(pane, ".dw-divider");
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider.getAttribute("aria-label")).toBe("Resize");
  });

  it("A4 layout puts the zoom inside the stage", () => {
    const { shell, parts: p } = mount();
    expect(p.zoom.parentElement).toBe(p.stage);
    expect(p.stage.parentElement).toBe(q(shell.root, ".dw-stage-column"));
  });

  it("A4 layout stage column holds the stage alone without notes", () => {
    const { shell } = mount();
    expect(parts(q(shell.root, ".dw-stage-column"))).toEqual(["stage"]);
  });

  it("A4 layout puts the notes under the stage", () => {
    const { shell } = mount({ notes: el("notes") });
    expect(parts(q(shell.root, ".dw-stage-column"))).toEqual(["stage", "notes"]);
  });

  it("A4 layout setMode sets data-mode on the root", () => {
    const { shell } = mount({ code: el("code") });
    shell.setMode("split");
    expect(shell.root.dataset["mode"]).toBe("split");
    shell.setMode("code");
    expect(shell.root.dataset["mode"]).toBe("code");
    shell.setMode("visual");
    expect(shell.root.dataset["mode"]).toBe("visual");
  });

  it("A4 layout destroy removes the root from the host", () => {
    const { host, shell } = mount();
    shell.destroy();
    expect(shell.root.isConnected).toBe(false);
    expect(host.querySelector(".dw")).toBeNull();
  });

  describe("divider drag", () => {
    const drag = (clientX: number): HTMLElement => {
      const { shell } = mount({ code: el("code") });
      const body = q(shell.root, ".dw-body");
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON() {} });
      const divider = q(shell.root, ".dw-divider");
      divider.setPointerCapture = jest.fn();
      divider.releasePointerCapture = jest.fn();
      divider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX }));
      divider.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX }));
      divider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX }));
      return shell.root;
    };

    it("A4 layout dragging the divider sets --dw-code-width as a percentage of the body", () => {
      expect(drag(450).style.getPropertyValue("--dw-code-width")).toBe("45%");
    });

    it("A4 layout dragging the divider clamps --dw-code-width at 20%", () => {
      expect(drag(40).style.getPropertyValue("--dw-code-width")).toBe("20%");
    });

    it("A4 layout dragging the divider clamps --dw-code-width at 80%", () => {
      expect(drag(990).style.getPropertyValue("--dw-code-width")).toBe("80%");
    });
  });
});
