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
      "Move to Trash",
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
      "Mark as Unread", "Mark as Reading", "Mark as Done", "Add Tag…", "Move to…", "Move to Trash",
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

const toasts = (): string[] => [...document.querySelectorAll(".ls-toast .msg")].map((m) => m.textContent ?? "");

describe("list header places", () => {
  afterEach(() => document.querySelectorAll(".ls-toasts").forEach((n) => n.remove()));

  it("shows All papers with the folder's count and Trash at zero, in the shared place header", () => {
    const t = mountForTest();
    t.snapshot(libraryListHeader, [], folders);
    const header = t.container.querySelector<HTMLElement>(".list-header")!;
    expect(header.classList.contains("ls-place-header")).toBe(true);
    const tabs = () => [...header.querySelectorAll<HTMLElement>(".ls-place-tab")];
    expect(tabs().map((tab) => tab.textContent)).toEqual(["All papers2", "Trash0"]);
    t.lib.store.openFolder("papers/A");
    expect(tabs()[0]!.textContent).toBe("All papers1");
  });

  it("opens the Trash: trashed papers newest first, Add hidden, Empty trash shown; a folder returns to All papers", () => {
    const t = mountForTest();
    t.snapshot([
      ...libraryListHeader,
      paper("old", "papers/A", { title: "Old", trashedAt: "2025-01-01T00:00:00.000Z" }),
      paper("new", "papers", { title: "New", trashedAt: "2025-06-01T00:00:00.000Z" }),
    ], [], folders);
    expect([...t.container.querySelectorAll(".ls-place-tab")].map((tab) => tab.textContent)).toEqual(["All papers2", "Trash2"]);
    t.lib.store.set({ selected: new Set(["r"]), anchor: "r", cursor: "r" });
    t.container.querySelector<HTMLElement>('.list-header [data-place="trash"]')!.click();
    const selected = [...t.container.querySelectorAll<HTMLElement>(".ls-place-tab")].map((tab) => tab.getAttribute("aria-selected"));
    expect(selected).toEqual(["false", "true"]);
    expect(t.lib.store.get().selected.size).toBe(0);
    expect([...t.container.querySelectorAll<HTMLElement>(".paper-row")].map((r) => r.dataset["id"])).toEqual(["new", "old"]);
    expect(t.container.querySelector<HTMLElement>('[data-act="new"]')?.hidden ?? true).toBe(true);
    const empty = t.container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!;
    expect(empty.hidden).toBe(false);
    expect(empty.disabled).toBe(false);
    t.lib.store.openFolder("papers/A");
    expect(t.lib.store.get().place).toBe("papers");
  });

  it("offers Restore and Delete Forever in the Trash, and Empty trash confirms before removing every trashed paper", async () => {
    const t = mountForTest();
    t.snapshot([...libraryListHeader, paper("g", "papers", { title: "Gone", trashedAt: "2025-01-01T00:00:00.000Z" })], [], folders);
    t.lib.store.setPlace("trash");
    rightClick(t, "g");
    expect(menuLabels()).toContain("Restore");
    expect(menuLabels()).toContain("Delete Forever…");
    item("Restore").click();
    expect(t.sent.at(-1)).toEqual({ type: "paper.restore", ids: ["g"] });
    t.container.querySelector<HTMLButtonElement>('[data-act="empty-trash"]')!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === "Empty Trash")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.remove", ids: ["g"] });
  });

  it("keeps the sidebar toggle first and hides Add when read-only", () => {
    const t = mountForTest();
    const header = t.container.querySelector<HTMLElement>(".list-header")!;
    expect(header.firstElementChild?.classList.contains("sidebar-toggle")).toBe(true);
    expect(header.querySelector('[data-act="new"]')?.textContent).toBe("Add");
    const ro = mountForTest({}, {}, { readOnly: true });
    expect(ro.container.querySelector('.list-header [data-act="new"]')).toBeNull();
  });
});

const foldersShareFolderButton = [{ name: "ml", path: "papers/ml", children: [] as [] }];
const libraryShareFolderButton = [paper("r", "papers"), paper("x", "papers/ml")];

function setup(offers: { projects: boolean; links: boolean }, readOnly = false) {
  const host = fakeHost({ offers: jest.fn(() => offers) });
  const t = mountForTest({}, {}, { sharing: host, readOnly });
  t.snapshot(libraryShareFolderButton, [], foldersShareFolderButton);
  const button = (): HTMLElement | null => t.container.querySelector<HTMLElement>(".list-header [data-act=share]");
  return { host, t, button };
}

describe("share menu", () => {
  afterEach(() => document.querySelectorAll(".ls-toasts, .ls-menu").forEach((n) => n.remove()));

  it("is absent without sharing and when read-only", () => {
    const none = mountForTest();
    expect(none.container.querySelector(".list-header [data-act=share]")).toBeNull();
    expect(setup({ projects: true, links: true }, true).button()).toBeNull();
  });

  it("disables Share folder at the library root and without a link offer", () => {
    const root = setup({ projects: true, links: true });
    root.button()!.click();
    expect(menuLabels()).toEqual(["Share folder…", "Share selected paper…"]);
    expect(item("Share folder…").disabled).toBe(true);
    const off = setup({ projects: false, links: false });
    off.t.lib.store.openFolder("papers/ml");
    off.button()!.click();
    expect(item("Share folder…").disabled).toBe(true);
  });

  it("shares the current folder through the folder share dialog", () => {
    const { host, t, button } = setup({ projects: false, links: true });
    t.lib.store.openFolder("papers/ml");
    button()!.click();
    item("Share folder…").click();
    expect(host.shareableFolder).toHaveBeenCalledWith("papers/ml");
  });

  it("enables Share selected paper only for exactly one selected paper, which shows the toast", () => {
    const { t, button } = setup({ projects: false, links: true });
    button()!.click();
    expect(item("Share selected paper…").disabled).toBe(true);
    t.lib.store.set({ selected: new Set(["r", "x"]), anchor: "r", cursor: "r" });
    button()!.click();
    expect(item("Share selected paper…").disabled).toBe(true);
    t.lib.store.set({ selected: new Set(["r"]), anchor: "r", cursor: "r" });
    button()!.click();
    expect(item("Share selected paper…").disabled).toBe(false);
    item("Share selected paper…").click();
    expect(toasts()).toContain("Still in implementation.");
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
