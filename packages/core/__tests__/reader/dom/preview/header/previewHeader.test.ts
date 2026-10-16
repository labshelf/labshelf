/**
 * @jest-environment jsdom
 */
// Tests the preview header: build and view groups, Recompile states, project commands and the toggle buttons.
import { mountPreviewHeader } from "../../../../../src/reader/dom/preview/header/index";

function fakeFind() {
  let listener: (open: boolean) => void = () => undefined;
  const find = {
    isOpen: false,
    show: jest.fn(() => { find.isOpen = true; listener(true); }),
    close: jest.fn(() => { find.isOpen = false; listener(false); }),
    onToggle: (fn: (open: boolean) => void) => { listener = fn; },
  };
  return find;
}

function fakeSidebar() {
  let listener: (s: { open: boolean }) => void = () => undefined;
  const sidebar = {
    isOpen: false,
    toggle: jest.fn(() => { sidebar.isOpen = !sidebar.isOpen; listener({ open: sidebar.isOpen }); }),
    onChange: (fn: (s: { open: boolean }) => void) => { listener = fn; },
  };
  return sidebar;
}

function setup() {
  const post = jest.fn();
  const find = fakeFind();
  const sidebar = fakeSidebar();
  const pill = document.createElement("div");
  pill.id = "status-pill";
  const header = mountPreviewHeader({ post, find, sidebar, pill });
  document.body.replaceChildren(header.element);
  const q = <T extends Element = HTMLButtonElement>(sel: string) => header.element.querySelector<T>(sel)!;
  const byName = (name: string) =>
    [...header.element.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name)!;
  return { header, post, find, sidebar, pill, q, byName };
}

describe("mountPreviewHeader structure", () => {
  it("is a labelled toolbar with the build group before the view group", () => {
    const { header, q } = setup();
    expect(header.element.tagName).toBe("HEADER");
    expect(header.element.classList.contains("rd-preview-header")).toBe(true);
    expect(header.element.getAttribute("role")).toBe("toolbar");
    expect(header.element.getAttribute("aria-label")).toBe("Preview");
    const build = q(".rd-preview-build");
    const view = q(".rd-preview-view");
    expect(build.compareDocumentPosition(view) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(build.parentElement).toBe(header.element);
    expect(view.parentElement).toBe(header.element);
  });

  it("offers four hidden empty slots named options, only, logs and export in the build group", () => {
    const { header, q } = setup();
    expect(Object.keys(header.slots).sort()).toEqual(["export", "logs", "only", "options"]);
    for (const name of ["options", "only", "logs", "export"] as const) {
      const slot = header.slots[name];
      expect(slot.getAttribute("data-slot")).toBe(name);
      expect(slot.classList.contains("rd-preview-slot")).toBe(true);
      expect(slot.hidden).toBe(true);
      expect(slot.childNodes).toHaveLength(0);
      expect(q(".rd-preview-build").contains(slot)).toBe(true);
    }
  });

  it("orders the build group Recompile then options, only, logs, export", () => {
    const { q } = setup();
    const order = [...q<HTMLElement>(".rd-preview-build").children].map(
      (c) => c.getAttribute("data-slot") ?? (c.matches(".rd-preview-recompile") ? "recompile" : ""),
    );
    expect(order.filter(Boolean)).toEqual(["recompile", "options", "only", "logs", "export"]);
  });

  it("puts the passed pill element inside the view group", () => {
    const { pill, q } = setup();
    expect(q(".rd-preview-view").contains(pill)).toBe(true);
  });

  it("gives every button an accessible name", () => {
    const { header } = setup();
    const buttons = [...header.element.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) {
      const name = b.getAttribute("aria-label") || b.title || b.textContent?.trim();
      expect(name).toBeTruthy();
    }
  });
});

describe("mountPreviewHeader Recompile", () => {
  it("shows the visible label and posts recompile on click", () => {
    const { q, post } = setup();
    const button = q(".rd-preview-recompile");
    expect(button.textContent).toContain("Recompile");
    button.click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });

  it("follows setBuild in data-state and sets aria-busy only while building", () => {
    const { header, q } = setup();
    const button = q(".rd-preview-recompile");
    header.setBuild("stale");
    expect(button.dataset["state"]).toBe("stale");
    expect(button.hasAttribute("aria-busy")).toBe(false);
    header.setBuild("building");
    expect(button.dataset["state"]).toBe("building");
    expect(button.getAttribute("aria-busy")).toBe("true");
    header.setBuild("current");
    expect(button.dataset["state"]).toBe("current");
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("stays enabled and clickable while building", () => {
    const { header, q, post } = setup();
    header.setBuild("building");
    const button = q(".rd-preview-recompile");
    expect(button.disabled).toBe(false);
    button.click();
    expect(post).toHaveBeenCalledWith({ command: "recompile" });
  });
});

describe("mountPreviewHeader view group", () => {
  it("posts the project commands from Compare and Mark", () => {
    const { byName, post } = setup();
    byName("Compare").click();
    expect(post).toHaveBeenLastCalledWith({ command: "runCommand", id: "compareVersions" });
    byName("Mark").click();
    expect(post).toHaveBeenLastCalledWith({ command: "runCommand", id: "markVersion" });
  });

  it("toggles Dark PDF through selectTheme and follows setDark", () => {
    const { header, byName, post } = setup();
    const dark = byName("Dark PDF");
    expect(dark.getAttribute("aria-pressed")).toBe("false");
    dark.click();
    expect(post).toHaveBeenLastCalledWith({ command: "selectTheme", theme: "dark" });
    header.setDark(true);
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    dark.click();
    expect(post).toHaveBeenLastCalledWith({ command: "selectTheme", theme: "light" });
    header.setDark(false);
    expect(dark.getAttribute("aria-pressed")).toBe("false");
  });

  it("opens and closes Find, and mirrors its state in aria-pressed", () => {
    const { byName, find } = setup();
    const button = byName("Find");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(find.show).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    button.click();
    expect(find.close).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("follows the find bar when it closes on its own", () => {
    const { byName, find } = setup();
    const button = byName("Find");
    button.click();
    find.close();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggles the sidebar and mirrors its state in aria-pressed", () => {
    const { q, sidebar, byName } = setup();
    const button = byName("Sidebar");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(sidebar.toggle).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    sidebar.toggle();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(q(".rd-preview-view").contains(button)).toBe(true);
  });
});
