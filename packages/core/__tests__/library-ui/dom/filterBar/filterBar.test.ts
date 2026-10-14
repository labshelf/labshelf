/**
 * @jest-environment jsdom
 */
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

const scan = { state: "missing" as const, checkedAt: "" };
const library = [
  paper("a", "papers", { textLayer: scan }),
  paper("b", "papers", { status: "done" }),
  paper("c", "papers", { textLayer: { state: "failed", checkedAt: "" }, status: "done" }),
];
const pdfs = ["papers/a", "papers/b", "papers/c"];

const noTextTab = (t: ReturnType<typeof mountForTest>): HTMLElement | null => t.container.querySelector(".tl-tab");

describe("filter bar", () => {
  it("tells how to mark the selection on each status tab", () => {
    const t = mountForTest();
    t.snapshot(library, pdfs);
    const titles = [...t.container.querySelectorAll<HTMLElement>(".status-tab")].map((b) => b.title);
    expect(titles[1]).toMatch(/^Show unread papers\. Mark the selection with (Alt\+|⌥)1$/);
  });

  it("offers No text only to a host that knows text layers, and only while a paper lacks one", () => {
    expect(noTextTab(mountForTest())).toBeNull();
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, pdfs);
    expect(noTextTab(t)?.querySelector(".n")?.textContent).toBe("2");
    t.snapshot([paper("b", "papers")], ["papers/b"]);
    expect(noTextTab(t)).toBeNull();
  });

  it("narrows the rows and the status counts to papers without text", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, pdfs);
    noTextTab(t)!.click();
    expect(t.rowIds()).toEqual(["a", "c"]);
    const counts = [...t.container.querySelectorAll(".status-tab:not(.tl-tab) .n")].map((n) => n.textContent);
    expect(counts).toEqual(["2", "1", "0", "1"]);
    t.key("Escape");
    expect(t.lib.store.get().noText).toBe(false);
  });

  it("hides the subfolder toggle in a folder without subfolders", () => {
    const t = mountForTest();
    t.snapshot(library, pdfs);
    expect(t.container.querySelector<HTMLElement>('[data-act="includeSub"]')!.hidden).toBe(true);
    t.snapshot(library, pdfs, [{ name: "A", path: "papers/A", children: [] }]);
    expect(t.container.querySelector<HTMLElement>('[data-act="includeSub"]')!.hidden).toBe(false);
  });
});
