/**
 * @jest-environment jsdom
 */
// Tests the states of the paper list: empty, loading, a failed file listing, long text, narrow width and the details toggle.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mountForTest, paper } from "../mountHarness";

const SUB = { name: "Sub", path: "papers/Sub", children: [] as [] };
const library = [paper("a", "papers", { title: "Alpha" })];
const text = (t: ReturnType<typeof mountForTest>): string => t.container.querySelector(".ls-empty-text")?.textContent ?? "";

describe("empty states", () => {
  it("says the library has no papers when nothing has been added", () => {
    const t = mountForTest();
    t.snapshot([]);
    expect(text(t)).toBe("Your library has no papers yet");
    expect(t.container.querySelector(".ls-empty-hint")).not.toBeNull();
  });

  it("says the folder has no papers when other folders do", () => {
    const t = mountForTest();
    t.snapshot(library, [], [SUB]);
    t.lib.store.openFolder("papers/Sub");
    expect(text(t)).toBe("No papers in Sub yet");
  });

  it("says nothing matches when a search finds no paper", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.lib.store.set({ query: "zzz" });
    expect(text(t)).toBe("No papers match “zzz” in All papers");
    expect(t.container.querySelector(".ls-empty button")?.textContent).toBe("Clear filters");
  });

  it("names the status scope when it holds no paper", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.lib.store.set({ status: "done" });
    expect(text(t)).toBe("No papers marked Done");
  });

  it("names the status scope when a search in it finds no paper", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.lib.store.set({ status: "unread", query: "zzz" });
    expect(text(t)).toBe("No papers match “zzz” in Unread");
  });

  it("keeps the three messages distinct", () => {
    const t = mountForTest();
    t.snapshot([]);
    const library0 = text(t);
    t.snapshot(library, [], [SUB]);
    t.lib.store.openFolder("papers/Sub");
    const folder = text(t);
    t.lib.store.openFolder("papers");
    t.lib.store.set({ query: "zzz" });
    expect(new Set([library0, folder, text(t)]).size).toBe(3);
  });
});

describe("loading and failure", () => {
  it("shows a loading state with a status role until the first snapshot", () => {
    const t = mountForTest();
    const loading = t.container.querySelector(".list-loading");
    expect(loading?.getAttribute("role")).toBe("status");
    expect(loading?.textContent).toContain("Loading papers…");
    t.snapshot(library);
    expect(t.container.querySelector(".list-loading")).toBeNull();
  });

  it("shows Loading files… in the tray until the listing arrives", () => {
    const t = mountForTest();
    t.snapshot(library, ["papers/a"]);
    t.click(".expand-btn");
    expect(t.container.querySelector(".paper-children .file-state")?.textContent).toContain("Loading files…");
  });

  it("logs a failed listing with the paper, shows the failed row and raises a toast", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = mountForTest();
    t.snapshot(library, ["papers/a"]);
    t.click(".expand-btn");
    t.files("a", { status: "failed", message: "disk gone" });
    expect(t.container.querySelector(".paper-children .file-state.failed")?.textContent).toContain("disk gone");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("LabShelf library"), { id: "a", title: "Alpha", message: "disk gone" });
    const toast = document.querySelector(".ls-toast.error");
    expect(toast?.textContent).toContain("Alpha");
    expect(toast?.textContent).toContain("disk gone");
    warn.mockRestore();
  });
});

describe("long text and layout", () => {
  it("carries the full title as a tooltip on the ellipsized title cell", () => {
    const long = "A very long title ".repeat(12).trim();
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { title: long })]);
    expect(t.container.querySelector(".title-cell")?.getAttribute("title")).toBe(long);
    expect(readFileSync(join(__dirname, "../../../../src/library-ui/dom/styles/library-list.css"), "utf8"))
      .toMatch(/\.title-cell > \.title-text \{[^}]*text-overflow: ellipsis/);
  });

  it("toggles the details pane from the header", () => {
    const t = mountForTest();
    expect(t.container.querySelector(".ls-library")!.classList.contains("detail-collapsed")).toBe(false);
    t.click('[data-act="detail"]');
    expect(t.container.querySelector(".ls-library")!.classList.contains("detail-collapsed")).toBe(true);
    t.click('[data-act="detail"]');
    expect(t.container.querySelector(".ls-library")!.classList.contains("detail-collapsed")).toBe(false);
  });

  it("marks the Year cell and head so the narrow layout can hide them", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { year: 2020 })]);
    expect(t.container.querySelector(".col-head.col-year")).not.toBeNull();
    expect(t.container.querySelector(".paper-row-main .col-year")?.textContent).toBe("2020");
  });

  it("keeps --heads-h in step with the column heads when they resize", () => {
    let notify: () => void = () => undefined;
    const disconnect = jest.fn();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(cb: () => void) { notify = cb; } observe(): void {} disconnect = disconnect; };
    const t = mountForTest();
    t.snapshot(library);
    const heads = t.container.querySelector<HTMLElement>(".col-heads")!;
    Object.defineProperty(heads, "offsetHeight", { configurable: true, value: 41 });
    notify();
    expect(t.container.querySelector<HTMLElement>(".paper-list")!.style.getPropertyValue("--heads-h")).toBe("41px");
    t.lib.dispose();
    expect(disconnect).toHaveBeenCalled();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });
});

describe("narrow list pane", () => {
  const css = readFileSync(join(__dirname, "../../../../src/library-ui/dom/styles/library-list.css"), "utf8");
  const block = (width: number): string => css.match(new RegExp(`@container list-pane \\(max-width: ${width}px\\) \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";

  it("hides Last read first, then Authors, then Year, from wider to narrower", () => {
    expect(block(720)).toContain(".col-read");
    expect(block(460)).toContain(".col-creator");
    expect(block(340)).toContain(".col-year");
    expect(block(720)).not.toContain(".col-creator");
    expect(block(460)).not.toContain(".col-year");
  });

  it("moves the tray fact under the name instead of squeezing it into a hidden column", () => {
    expect(block(460)).toMatch(/\.file-row \{[^}]*flex-wrap: wrap/);
    expect(block(460)).toMatch(/\.file-fact \{[^}]*flex-basis/);
  });
});
