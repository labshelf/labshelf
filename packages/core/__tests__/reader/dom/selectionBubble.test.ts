/**
 * @jest-environment jsdom
 */
// Checks that the bubble's highlight action sends the selection's page rectangle, and that View in source and Comment show only while the shown root maps to its source.
import { SelectionBubble } from "../../../src/reader/dom/selectionBubble";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import { closePopover } from "../../../src/reader/dom/elements";
import { Toolbar, type ToolbarActions } from "../../../src/reader/dom/toolbar";
import { AnnotationsTab } from "../../../src/reader/dom/sidebar";

function setup(commentOn?: () => void, openCite?: (citation: { page: number; quote: string }) => void, addToNote?: () => void, preview = commentOn !== undefined) {
  document.body.innerHTML = `<div id="selection-toolbar"></div>
    <div id="viewer"><div class="page" data-page-number="3"><div class="textLayer"><span id="s">Chain-of-thought prompting has several</span></div></div></div>`;
  const post = jest.fn();
  // A 1000 x 1000 px page showing a 500 x 500 pt PDF page (scale 2), the y axis flipped as in PDF space.
  const pageView = { viewport: {
    viewBox: [0, 0, 500, 500],
    convertToPdfPoint: (x: number, y: number) => [x / 2, 500 - y / 2],
    convertToViewportPoint: (x: number, y: number) => [x * 2, (500 - y) * 2],
  } };
  const ctx = { boot: { isMac: true, preview }, host: { post }, container: document.createElement("div"), pdfViewer: { currentPageNumber: 1, getPageView: () => pageView } } as unknown as ReaderContext;
  const bubble = new SelectionBubble(ctx, commentOn, addToNote, openCite);
  const text = document.getElementById("s")!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(text);
  const box = { left: 100, top: 200, right: 600, bottom: 230, width: 500, height: 30, x: 100, y: 200, toJSON: () => ({}) } as DOMRect;
  range.getBoundingClientRect = () => box;
  range.getClientRects = () => [box] as unknown as DOMRectList;
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  const page = document.querySelector<HTMLElement>(".page")!;
  Object.defineProperty(page, "clientWidth", { value: 1000 });
  Object.defineProperty(page, "clientHeight", { value: 1000 });
  page.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return { post, bubble, ctx };
}

describe("SelectionBubble highlight", () => {
  it("sends the selected rectangle in page coordinates with the highlight", () => {
    const { post } = setup();
    document.querySelector<HTMLButtonElement>('button[title="Highlight yellow"]')!.click();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      command: "createAnnotation",
      color: "yellow",
      position: { x: 0.1, y: 0.2, width: 0.5, height: 0.03 },
    }));
  });
});

describe("SelectionBubble comment", () => {
  const commentButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Comment on the source"]')!;

  it("hides Comment until the shown root maps to its source", () => {
    const { bubble } = setup(jest.fn());
    expect(commentButton().hidden).toBe(true);
    bubble.setSourceLinked(true);
    expect(commentButton().hidden).toBe(false);
    bubble.setSourceLinked(false);
    expect(commentButton().hidden).toBe(true);
  });
});

describe("SelectionBubble view in source", () => {
  const sourceButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="View in source"]');
  const separators = () => [...document.querySelectorAll<HTMLElement>("#selection-toolbar .ls-pill-sep")];

  it("is hidden until the shown root has source links, before Comment, and hides again", () => {
    const { bubble } = setup(jest.fn());
    const comment = document.querySelector('button[aria-label="Comment on the source"]')!;
    expect(sourceButton()!.hidden).toBe(true);
    expect(separators().at(-1)!.hidden).toBe(true);
    expect(sourceButton()!.nextElementSibling).toBe(comment);
    bubble.setSourceLinked(true);
    expect(sourceButton()!.hidden).toBe(false);
    expect(separators().at(-1)!.hidden).toBe(false);
    bubble.setSourceLinked(false);
    expect(sourceButton()!.hidden).toBe(true);
  });

  it("posts showSource with the point at the start of the selection, then clears it and hides the bubble", () => {
    const { bubble, post } = setup(jest.fn());
    bubble.setSourceLinked(true);
    document.getElementById("selection-toolbar")!.classList.add("rd-visible");
    sourceButton()!.click();
    // The first line starts at x 100 (+1), y 215 on the page: half of that in PDF points, the y measured from the top.
    expect(post).toHaveBeenCalledWith({ command: "showSource", point: { page: 3, x: 50.5, y: 107.5 } });
    expect(window.getSelection()!.toString()).toBe("");
    expect(document.getElementById("selection-toolbar")!.classList.contains("rd-visible")).toBe(false);
  });

  it("is absent outside a build preview", () => {
    setup();
    expect(sourceButton()).toBeNull();
  });
});


describe("SelectionBubble header tools", () => {
  it("underlines an existing selection with a persisted style", () => {
    const { post, bubble } = setup();
    bubble.setTool("underline");
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation", style: "underline", pageNumber: 3 }));
  });

  it("clears the active tool on Escape", () => {
    const { bubble } = setup();
    window.getSelection()?.removeAllRanges();
    bubble.onToolChange = jest.fn();
    bubble.setTool("highlight");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bubble.onToolChange).toHaveBeenLastCalledWith(null);
  });
});


it.each(["highlight", "underline"] as const)("uses the chosen colour for the header %s tool", (tool) => {
  const { post, bubble } = setup();
  bubble.setColor("pink");
  bubble.setTool(tool);
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation", color: "pink", ...(tool === "underline" ? { style: "underline" } : {}) }));
});


it("places an unhighlighted note by clicking the page with Add note active", async () => {
  const { bubble, ctx, post } = setup();
  window.getSelection()?.removeAllRanges();
  ctx.container.append(document.getElementById("viewer")!);
  document.body.append(ctx.container);
  bubble.onPlaceNote = jest.fn();
  bubble.setTool("note");
  document.querySelector(".page")!.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 700, clientY: 400 }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(bubble.onPlaceNote).toHaveBeenCalledWith(3, 0.7, 0.4);
  expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ command: "createAnnotation" }));
});


describe("SelectionBubble cite", () => {
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("#selection-toolbar button")].filter((b) => !b.classList.contains("rd-color-btn"));

  it("shows Add to note and one quote button, with no Send to and no book-plus button", () => {
    setup(undefined, jest.fn(), jest.fn());
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Add to note", "Cite…"]);
    expect(document.querySelector("#selection-toolbar")!.textContent).not.toMatch(/send to/i);
    expect(document.querySelectorAll("#selection-toolbar .ls-pill-sep")).toHaveLength(2);
  });

  const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>(".rd-popover .rd-menu-item")];
  const menuItem = (label: string) => menuItems().find((b) => b.textContent?.includes(label))!;

  afterEach(() => closePopover());

  it("shows a two-item menu when the quote button is clicked, without opening the popup yet", () => {
    const openCite = jest.fn();
    const { post } = setup(undefined, openCite);
    buttons().at(-1)!.click();
    expect(menuItems().map((b) => b.textContent?.trim())).toEqual(["Copy with citation", "Cite in a project…"]);
    expect(menuItems().every((b) => b.querySelector("svg"))).toBe(true);
    expect(openCite).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("copies the selection with its citation from the menu and hides the bubble", () => {
    const openCite = jest.fn();
    const { post } = setup(undefined, openCite);
    document.getElementById("selection-toolbar")!.classList.add("rd-visible");
    buttons().at(-1)!.click();
    menuItem("Copy with citation").click();
    expect(post).toHaveBeenCalledWith({ command: "copyWithCitation", text: "Chain-of-thought prompting has several", pageNumber: 3 });
    expect(openCite).not.toHaveBeenCalled();
    expect(document.querySelector(".rd-popover")).toBeNull();
    expect(document.getElementById("selection-toolbar")!.classList.contains("rd-visible")).toBe(false);
  });

  it("opens the cite popup with the page and passage from the menu", () => {
    const openCite = jest.fn();
    const { post } = setup(undefined, openCite);
    buttons().at(-1)!.click();
    menuItem("Cite in a project…").click();
    expect(openCite).toHaveBeenCalledWith({ page: 3, quote: "Chain-of-thought prompting has several" });
    expect(post).not.toHaveBeenCalled();
  });

  it("uses the selection captured at the click even when it is gone by the time an item is chosen", () => {
    const openCite = jest.fn();
    setup(undefined, openCite);
    buttons().at(-1)!.click();
    window.getSelection()!.removeAllRanges();
    menuItem("Cite in a project…").click();
    expect(openCite).toHaveBeenCalledWith({ page: 3, quote: "Chain-of-thought prompting has several" });
  });

  it("closes the menu on Escape and keeps the quote button usable", () => {
    const { post } = setup(undefined, jest.fn());
    buttons().at(-1)!.click();
    menuItem("Copy with citation").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".rd-popover")).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("does not show the bubble again after an item is chosen with the mouse", async () => {
    setup(undefined, jest.fn());
    buttons().at(-1)!.click();
    const item = menuItem("Copy with citation");
    item.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    item.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.getElementById("selection-toolbar")!.classList.contains("rd-visible")).toBe(false);
  });

  it("copies with citation when there is no cite opener", () => {
    const { post } = setup();
    expect(buttons()).toHaveLength(1);
    buttons()[0]!.click();
    expect(post).toHaveBeenCalledWith({ command: "copyWithCitation", text: "Chain-of-thought prompting has several", pageNumber: 3 });
  });
});


describe("the same quote menu on the toolbar and on a highlight", () => {
  const items = () => [...document.querySelectorAll<HTMLButtonElement>(".rd-popover .rd-menu-item")];
  const item = (label: string) => items().find((b) => b.textContent?.includes(label))!;
  afterEach(() => closePopover());

  function toolbarWith(extra: Partial<ToolbarActions>) {
    document.body.innerHTML = `<div id="pdf-shell"><div id="toolbar"></div></div>`;
    const noop = () => undefined;
    const actions: ToolbarActions = { toggleSidebar: noop, previousPage: noop, nextPage: noop, toggleDetails: noop, selectTool: noop, selectColor: noop, openFind: noop, toggleBoxTool: noop, openAppearance: noop, openCheatsheet: noop, ...extra };
    new Toolbar(document.createElement("div"), false, true, actions);
    return document.querySelector<HTMLButtonElement>('#toolbar button[title="Cite…"]')!;
  }

  it("toolbar: Cite… shows Copy citation and Cite in a project…", () => {
    const copyCitation = jest.fn();
    const citeInProject = jest.fn();
    const button = toolbarWith({ copyCitation, citeInProject });
    button.click();
    expect(items().map((b) => b.textContent?.trim())).toEqual(["Copy citation", "Cite in a project…"]);
    expect(citeInProject).not.toHaveBeenCalled();
    item("Copy citation").click();
    expect(copyCitation).toHaveBeenCalledTimes(1);
    expect(citeInProject).not.toHaveBeenCalled();
    button.click();
    item("Cite in a project…").click();
    expect(citeInProject).toHaveBeenCalledTimes(1);
  });

  it("highlight: Cite… shows the menu with the highlight's page and text", () => {
    const post = jest.fn();
    const openCite = jest.fn();
    const tab = new AnnotationsTab({ post } as never, jest.fn(), openCite);
    document.body.append(tab.el);
    tab.setAnnotations([{ id: "a1", type: "highlight", pageNumber: 5, color: "yellow", content: "Shelves bend." } as never]);
    const button = tab.el.querySelector<HTMLButtonElement>('button[title="Cite…"]')!;
    button.click();
    expect(items().map((b) => b.textContent?.trim())).toEqual(["Copy with citation", "Cite in a project…"]);
    expect(openCite).not.toHaveBeenCalled();
    item("Copy with citation").click();
    expect(post).toHaveBeenCalledWith({ command: "copyWithCitation", text: "Shelves bend.", pageNumber: 5 });
    button.click();
    item("Cite in a project…").click();
    expect(openCite).toHaveBeenCalledWith(5, "Shelves bend.");
  });
});
