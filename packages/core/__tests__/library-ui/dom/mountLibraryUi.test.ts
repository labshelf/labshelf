/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "./mountHarness";

const folders = [{ name: "A", path: "papers/A", children: [] as [] }];
const library = [paper("r", "papers", { title: "Root paper" }), paper("x", "papers/A", { title: "Nested paper" })];

describe("mountLibraryUi", () => {
  it("says ready once mounted", () => {
    const t = mountForTest();
    expect(t.sent[0]).toEqual({ type: "ready" });
  });

  it("opens a folder the host navigates to without echoing the first render", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "navigate", folder: "papers/A" });
    expect(t.lib.store.get().folder).toBe("papers/A");
    expect(t.rowIds()).toEqual(["x"]);
    expect(t.sent.filter((m) => m.type === "navigate")).toEqual([{ type: "navigate", folder: "papers/A" }]);
  });

  it("tells the host when the user opens a subfolder chip, resetting search and selection", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.set({ query: "paper", selected: new Set(["r"]) });
    t.container.querySelector<HTMLElement>(".ls-chip")!.click();
    expect(t.sent).toContainEqual({ type: "navigate", folder: "papers/A" });
    expect(t.lib.store.get()).toMatchObject({ folder: "papers/A", query: "", status: "all" });
    expect(t.lib.store.get().selected.size).toBe(0);
  });

  it("shows the selected paper in the detail pane", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "select", id: "r" });
    expect(t.container.querySelector(".detail-paper-title")?.textContent).toBe("Root paper");
  });

  it("asks the host to attach a PDF inside the click itself", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "select", id: "r" });
    t.container.querySelector<HTMLElement>('[data-action="attach-pdf"]')!.click();
    expect(t.sent.at(-1)).toEqual({ type: "paper.attachPdf", id: "r" });
  });

  it("marks a paper's PDF search as running while the host says it is busy", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "select", id: "r" });
    t.host.post({ type: "pdf.busy", id: "r", busy: true });
    expect(t.container.querySelector<HTMLButtonElement>('.detail-action-row [data-action="find-pdf"]')!.disabled).toBe(true);
    t.container.querySelector<HTMLElement>('.detail-action-row [data-action="find-pdf"]')!.click();
    expect(t.sent.some((m) => m.type === "paper.findPdf")).toBe(false);
  });

  it("removes its frame on dispose", () => {
    const t = mountForTest();
    t.lib.dispose();
    expect(t.container.querySelector(".ls-library")).toBeNull();
  });
});
