/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — header and insert bar.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { createInsertBar, createShellHeader, type InsertItem, type ShellHeaderSpec } from "../../../../src/decks/dom/shell/index.js";
import { byLabel, click, hasIcon, q, text } from "./shellHarness.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});


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
