/**
 * @jest-environment jsdom
 */
// Tests that one paper at a time is open, that opening requests its files and that the tray waits for them.
import { mountForTest, paper } from "../../mountHarness";

const library = [paper("a", "papers", { title: "Alpha" }), paper("b", "papers", { title: "Beta" })];
const PDFS = ["papers/a", "papers/b"];

type T = ReturnType<typeof mountForTest>;
const mounted = (): T => { const t = mountForTest(); t.snapshot(library, PDFS); return t; };
const unit = (t: T, id: string): HTMLElement => t.rows().find((r) => r.dataset["id"] === id)!;
const main = (t: T, id: string): HTMLElement => unit(t, id).querySelector<HTMLElement>(".paper-row-main")!;
const twistie = (t: T, id: string): HTMLElement => unit(t, id).querySelector<HTMLElement>(".expand-btn")!;
const filesRequests = (t: T): unknown[] => t.sent.filter((m) => m.type === "paper.files");
const trayRows = (t: T, id: string): HTMLElement[] => [...unit(t, id).querySelectorAll<HTMLElement>('.paper-children [role="row"]')];

describe("open paper", () => {
  it("opens on a twistie click and closes on a second click", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(t.lib.store.get().open).toBe("a");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("true");
    expect(unit(t, "a").classList.contains("expanded")).toBe(true);
    twistie(t, "a").click();
    expect(t.lib.store.get().open).toBeNull();
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
    expect(unit(t, "a").classList.contains("expanded")).toBe(false);
  });

  it("closes the open paper when another opens", () => {
    const t = mounted();
    twistie(t, "a").click();
    twistie(t, "b").click();
    expect(t.lib.store.get().open).toBe("b");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
    expect(main(t, "b").getAttribute("aria-expanded")).toBe("true");
    expect(t.container.querySelectorAll(".paper-row.expanded")).toHaveLength(1);
  });

  it("opens a collapsed paper on ArrowRight", () => {
    const t = mounted();
    t.key("ArrowDown");
    t.key("ArrowRight");
    expect(t.lib.store.get().open).toBe("a");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("true");
  });

  it("expands the paper a host reveal names", () => {
    const t = mounted();
    t.host.post({ type: "reveal", id: "b" });
    expect(main(t, "b").getAttribute("aria-expanded")).toBe("true");
    expect(main(t, "a").getAttribute("aria-expanded")).toBe("false");
  });

  it("requests the files once when a paper opens", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(filesRequests(t)).toEqual([{ type: "paper.files", id: "a" }]);
    t.files("a", { status: "ready", files: [] });
    expect(filesRequests(t)).toHaveLength(1);
  });

  it("shows Loading files… until the reply arrives", () => {
    const t = mounted();
    twistie(t, "a").click();
    expect(trayRows(t, "a")).toHaveLength(1);
    expect(trayRows(t, "a")[0]!.textContent).toContain("Loading files…");
    t.files("a", { status: "ready", files: [{ name: "paper.pdf", kind: "file", size: 10, modified: "2026-10-03T12:00:00Z" }] });
    expect(unit(t, "a").textContent).not.toContain("Loading files…");
    expect(trayRows(t, "a")[0]!.textContent).toContain("paper.pdf");
  });
});
