/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The sidebar tree lists scopes, folders and papers from the core derivation and reveals papers through the host.
import { LibraryViewStore, PAPERS_DIR, type PaperRecord } from "@labshelf/core";
import type { LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../../../src/library-page/prefs";
import { mountSidebarTree } from "../../../src/library-page/sidebar/sidebarTree";

const paper = (id: string, dir: string, title: string, status: PaperRecord["status"]): PaperRecord =>
  ({ id, title, path: `${dir}/${id}`, citeKey: `key-${id}`, status });

const folders = [
  { name: "A", path: "papers/A", children: [{ name: "B", path: "papers/A/B", children: [] }] },
  { name: "Z", path: "papers/Z", children: [] },
];
const papers = [
  paper("r1", "papers", "zeta root", "done"),
  paper("a1", "papers/A", "beta", "unread"),
  paper("a2", "papers/A", "Alpha", "done"),
  paper("b1", "papers/A/B", "deep", "reading"),
  paper("b2", "papers/A/B", "deeper", "reading"),
];

interface Setup { store: LibraryViewStore; slot: HTMLElement; posted: unknown[]; prefs: PagePrefs; saved: string[][] }

function mount(expanded: string[] = []): Setup {
  const store = new LibraryViewStore({ folders, papers, loading: false });
  const saved: string[][] = [];
  const prefs = { treeExpanded: () => expanded, saveTreeExpanded: (p: string[]) => { saved.push(p); } } as unknown as PagePrefs;
  const posted: unknown[] = [];
  const host = { post: (message: unknown) => { posted.push(message); } };
  const ui = { sidebar: null, store, folders: { create: jest.fn(), rename: jest.fn(), remove: jest.fn() }, dropTarget: jest.fn(), dispose: jest.fn() } as unknown as LibraryUi;
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  (mountSidebarTree as unknown as (...a: unknown[]) => unknown)(ui, slot, prefs, jest.fn(), host);
  return { store, slot, posted, prefs, saved };
}

const rows = (slot: HTMLElement): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".tree-row")];
const rowWithText = (slot: HTMLElement, text: string): HTMLElement => {
  const found = rows(slot).find((r) => (r.querySelector(".tree-label")?.textContent ?? r.textContent ?? "").trim().startsWith(text));
  if (!found) throw new Error(`no row "${text}"`);
  return found;
};
const folderRow = (slot: HTMLElement, path: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
const paperRow = (slot: HTMLElement, id: string): HTMLElement | null => slot.querySelector<HTMLElement>(`[data-id="${id}"]`);
const twisty = (slot: HTMLElement, path: string): void => { folderRow(slot, path).querySelector<HTMLElement>(".tree-twisty")!.click(); };
const order = (slot: HTMLElement): string[] => rows(slot).map((r) => r.dataset["path"] ?? r.dataset["id"] ?? (r.textContent ?? "").trim());

describe("sidebar tree", () => {
  it("shows the four scope rows first, each with its count", () => {
    const { slot } = mount();
    const texts = rows(slot).slice(0, 4).map((r) => (r.textContent ?? "").replace(/\s+/g, ""));
    expect(texts[0]).toMatch(/^Allpapers5/);
    expect(texts[1]).toMatch(/^Unread1/);
    expect(texts[2]).toMatch(/^Reading2/);
    expect(texts[3]).toMatch(/^Done2/);
  });

  it("lists top-level folders then the root's own papers, with recursive folder counts", () => {
    const { slot } = mount();
    expect(order(slot).slice(4)).toEqual(["papers/A", "papers/Z", "r1"]);
    expect((folderRow(slot, "papers/A").textContent ?? "").replace(/\s+/g, "")).toMatch(/^A4/);
  });

  it("shows a paper row as a REF label followed by the title, carrying the paper id", () => {
    const { slot } = mount();
    const row = paperRow(slot, "r1")!;
    const ref = [...row.querySelectorAll("*")].find((n) => n.textContent === "REF");
    expect(ref).toBeDefined();
    expect(row.textContent).toMatch(/REF\s*zeta root/);
  });

  it("expands a folder with its subfolders first, then its papers by title", () => {
    const { slot } = mount();
    twisty(slot, "papers/A");
    expect(order(slot).slice(4)).toEqual(["papers/A", "papers/A/B", "a2", "a1", "papers/Z", "r1"]);
  });

  it("opens All papers on the library root with every status", () => {
    const { slot, store } = mount();
    store.openFolder("papers/Z");
    store.set({ status: "done" });
    rowWithText(slot, "All papers").click();
    expect(store.get().folder).toBe(PAPERS_DIR);
    expect(store.get().status).toBe("all");
  });

  it("opens Reading on the library root with the reading status", () => {
    const { slot, store } = mount();
    store.openFolder("papers/Z");
    rowWithText(slot, "Reading").click();
    expect(store.get().folder).toBe(PAPERS_DIR);
    expect(store.get().status).toBe("reading");
  });

  it("posts a reveal message when a paper row is clicked", () => {
    const { slot, posted } = mount();
    paperRow(slot, "r1")!.click();
    expect(posted).toEqual([{ type: "reveal", id: "r1" }]);
  });

  it("reveals a paper that the current folder and status filter hide", () => {
    const { slot, store, posted } = mount(["papers/A"]);
    store.openFolder("papers/Z");
    store.set({ status: "done" });
    paperRow(slot, "a1")!.click();
    expect(posted).toEqual([{ type: "reveal", id: "a1" }]);
  });

  it("marks the selected paper and expands its ancestor folders", () => {
    const { slot, store } = mount();
    expect(paperRow(slot, "b1")).toBeNull();
    store.selectOnly("b1");
    expect(paperRow(slot, "b1")!.getAttribute("aria-selected")).toBe("true");
    expect(folderRow(slot, "papers/A/B").getAttribute("aria-expanded")).toBe("true");
  });

  it("clears the mark when the selection is empty or holds two papers", () => {
    const { slot, store } = mount(["papers/A"]);
    store.selectOnly("a1");
    expect(paperRow(slot, "a1")!.getAttribute("aria-selected")).toBe("true");
    store.set({ selected: new Set(["a1", "a2"]) });
    expect(paperRow(slot, "a1")!.getAttribute("aria-selected")).not.toBe("true");
    store.selectOnly("a2");
    store.clearSelection();
    expect(slot.querySelector("[data-id][aria-selected='true']")).toBeNull();
  });

  it("saves the expansion and restores it on the next mount", () => {
    const first = mount();
    twisty(first.slot, "papers/A");
    expect(first.saved.at(-1)).toContain("papers/A");
    const second = mount(first.saved.at(-1));
    expect(paperRow(second.slot, "a1")).not.toBeNull();
  });
});
