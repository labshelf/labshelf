/**
 * @jest-environment jsdom
 */
// Tests the library chrome: paper menu, list header (title, search, Share) and the sash.
import { ALL_CAPABILITIES, menuLabels, mountForTest, paper } from "./mountHarness";
import { fakeHost } from "../../collab/dom/fakeHost";
import { attachSash } from "../../../src/libraryUi/dom";

const library = [
  paper("a", "papers", { title: "Alpha", status: "done", textLayer: { state: "missing", checkedAt: "" } }),
  paper("b", "papers", { title: "Beta", status: "done" }),
];

function rightClick(t: ReturnType<typeof mountForTest>, id: string): void {
  const row = t.rows().find((r) => r.dataset["id"] === id)!;
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
}

const item = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.querySelector(".ls-menu-label")?.textContent === label)!;

describe("paper menu", () => {
  it("offers every action of the host for one paper, continuing at the last page", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, ["papers/a", "papers/b"], [], { a: { annotations: 2, lastPage: 12 } });
    rightClick(t, "a");
    expect(menuLabels()).toEqual([
      "Continue Reading (p. 12)", "Open in Default PDF App",
      "Copy Cite Key", "Copy BibTeX", "Copy APA Reference",
      "Mark as Unread", "Mark as Reading", "Mark as Done",
      "Add Tag…", "Move to…", "Reveal in Explorer", "Make Searchable (OCR)", "Fetch Metadata Online", "Export Annotations…",
      "Remove from Library…",
    ]);
    expect(item("Mark as Done").classList.contains("checked")).toBe(true);
    expect(item("Mark as Unread").classList.contains("checked")).toBe(false);
  });

  it("keeps to the shared actions on a host without capabilities", () => {
    const t = mountForTest();
    t.snapshot(library);
    rightClick(t, "b");
    expect(menuLabels()).toEqual([
      "Open PDF", "Copy Cite Key", "Copy BibTeX", "Copy APA Reference",
      "Mark as Unread", "Mark as Reading", "Mark as Done", "Add Tag…", "Move to…", "Remove from Library…",
    ]);
    expect(item("Open PDF").disabled).toBe(true);
  });

  it("acts on the whole selection", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, ["papers/a", "papers/b"]);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    expect(menuLabels()).toContain("Copy 2 Cite Keys");
    expect(menuLabels()).toContain("Make 1 Searchable");
    item("Mark as Reading").click();
    expect(t.sent).toContainEqual({ type: "paper.setStatus", ids: ["a", "b"], status: "reading" });
  });

});

describe("paper menu actions", () => {
  it("asks for tags in a prompt and adds them to the whole selection", async () => {
    const t = mountForTest();
    t.snapshot(library);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    item("Tag 2 Papers…").click();
    const input = document.querySelector<HTMLInputElement>(".ls-quick input")!;
    input.value = "ml, vision";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["a", "b"], add: ["ml", "vision"], remove: [] });
  });

  it("copies BibTeX built from the records", () => {
    const t = mountForTest();
    t.snapshot(library);
    rightClick(t, "a");
    item("Copy BibTeX").click();
    const copy = t.sent.at(-1) as { type: string; text: string; label: string };
    expect(copy).toMatchObject({ type: "clipboard.write", label: "BibTeX" });
    expect(copy.text).toContain("@article{key-a,");
    expect(copy.text).not.toContain("file =");
  });

  it("opens under the cursor row with the menu key and Shift+F10", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.key("ArrowDown");
    t.key("ContextMenu");
    expect(menuLabels()[0]).toBe("Open PDF");
    t.key("Escape");
    t.key("F10", { shiftKey: true });
    expect(document.querySelector(".ls-menu")).not.toBeNull();
  });
});


describe("Add to Space", () => {
  it.each([["a"], ["a", "b"]])("sends the selected papers %j to the host picker", (...ids: string[]) => {
    const capabilities = { ...ALL_CAPABILITIES, spaces: true };
    const t = mountForTest({}, capabilities);
    t.snapshot(library);
    t.lib.store.set({ selected: new Set(ids), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    expect(menuLabels()).toContain("Add to Space…");
    item("Add to Space…").click();
    expect(t.sent).toContainEqual({ type: "paper.addToSpace", ids });
  });

  it("hides the entry when the capability is disabled", () => {
    const capabilities = { ...ALL_CAPABILITIES, spaces: false };
    const t = mountForTest({}, capabilities);
    t.snapshot(library);
    rightClick(t, "a");
    expect(menuLabels()).not.toContain("Add to Space…");
  });
});

const folders = [{ name: "A", path: "papers/A", children: [] as [] }];
const libraryListHeader = [paper("r", "papers"), paper("x", "papers/A")];
const crumbs = (t: ReturnType<typeof mountForTest>): HTMLElement => t.container.querySelector<HTMLElement>(".breadcrumb")!;

describe("list header title", () => {
  it("reads Library alone in the root folder, the same name its crumb has inside a folder", () => {
    const t = mountForTest();
    t.snapshot(libraryListHeader, [], folders);
    expect(crumbs(t).textContent).toBe("Library");
  });

  it("reads Library then each folder inside a nested folder", () => {
    const t = mountForTest();
    t.snapshot(libraryListHeader, [], folders);
    t.lib.store.openFolder("papers/A");
    expect([...crumbs(t).querySelectorAll(".crumb")].map((c) => c.textContent?.trim())).toEqual(["Library", "A"]);
  });
});

describe("list header search", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sets the query once with the latest text after rapid input", () => {
    const t = mountForTest();
    const search = t.container.querySelector<HTMLInputElement>(".ls-library-search")!;
    for (const text of ["a", "ab", "abc"]) { search.value = text; search.dispatchEvent(new Event("input")); }
    expect(t.lib.store.get().query).toBe("");
    jest.advanceTimersByTime(80);
    expect(t.lib.store.get().query).toBe("abc");
  });
});

const foldersShareFolderButton = [{ name: "ml", path: "papers/ml", children: [] as [] }];
const libraryShareFolderButton = [paper("r", "papers"), paper("x", "papers/ml")];

function setup(offers: { projects: boolean; links: boolean }, readOnly = false) {
  const host = fakeHost({ offers: jest.fn(() => offers) });
  const t = mountForTest({}, {}, { sharing: host, readOnly });
  t.snapshot(libraryShareFolderButton, [], foldersShareFolderButton);
  const button = (): HTMLElement | null => t.container.querySelector<HTMLElement>("[data-act=share]");
  return { host, t, button };
}

describe("share folder button", () => {
  it("is absent when no link offer, when read-only, and at the library root", () => {
    expect(setup({ projects: false, links: false }).button()).toBeNull();
    const ro = setup({ projects: true, links: true }, true);
    ro.t.lib.store.openFolder("papers/ml");
    expect(ro.button()).toBeNull();
    expect(setup({ projects: true, links: true }).button()).toBeNull();
  });

  it("appears inside a folder and asks the host for that folder on click", () => {
    const { host, t, button } = setup({ projects: false, links: true });
    t.lib.store.openFolder("papers/ml");
    expect(button()?.getAttribute("aria-label")).toBe('Share "ml" as a link');
    button()!.click();
    expect(host.shareableFolder).toHaveBeenCalledWith("papers/ml");
  });
});

describe("sash", () => {
  let root: HTMLElement;
  let pane: HTMLElement;
  let sash: HTMLElement;
  const persist = jest.fn();

  const fire = (type: string, init: { clientX?: number; button?: number } = {}): void => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(e, "pointerId", { value: 1 });
    sash.dispatchEvent(e);
  };

  beforeEach(() => {
    persist.mockReset();
    root = document.createElement("div");
    pane = document.createElement("div");
    sash = document.createElement("div");
    pane.style.width = "200px";
    root.append(pane, sash);
    document.body.append(root);
    // jsdom has no pointer capture.
    sash.setPointerCapture = jest.fn();
    sash.releasePointerCapture = jest.fn();
    attachSash(sash, {
      root, pane, collapsedClass: "collapsed", limits: { min: 100, max: 500, collapseAt: 50 },
      widthFromPointer: (x) => x, persist,
    });
  });
  afterEach(() => root.remove());

  test("pointer capture is taken on pointerdown and a drag resizes the pane", () => {
    fire("pointerdown", { button: 0 });
    expect(sash.setPointerCapture).toHaveBeenCalledWith(1);
    expect(root.classList.contains("resizing")).toBe(true);
    fire("pointermove", { clientX: 300 });
    expect(pane.style.width).toBe("300px");
  });

  test.each(["pointerup", "pointercancel", "lostpointercapture"])("%s ends the drag once and later moves are ignored", (type) => {
    fire("pointerdown", { button: 0 });
    fire("pointermove", { clientX: 300 });
    fire(type);
    fire("lostpointercapture");
    expect(root.classList.contains("resizing")).toBe(false);
    expect(sash.classList.contains("dragging")).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(300, false);
    fire("pointermove", { clientX: 400 });
    expect(pane.style.width).toBe("300px");
  });

  test("a non-primary button does not start a drag", () => {
    fire("pointerdown", { button: 2 });
    expect(root.classList.contains("resizing")).toBe(false);
    expect(sash.setPointerCapture).not.toHaveBeenCalled();
  });
});
