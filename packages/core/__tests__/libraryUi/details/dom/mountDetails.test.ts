/**
 * @jest-environment jsdom
 */
import {
  DEFAULT_PREFS, createLoopbackTransport, type DetailsTarget, type DetailsToHost, type HostToDetails, type HostToUi, type LibraryUiPrefs, type PaperRecord,
} from "@labshelf/core";
import { mountDetails } from "../../../../src/libraryUi/details/dom";
import { row } from "../../../writing/allProjects/dom/detailPane/fixtures";

const LABELS = { addTooltip: "Add a paper", emptyHint: "Papers come in through the Add button.", revealPaper: "Reveal in Explorer" };
const EMPTY = "Select a paper or project to see its details.";

function paper(id: string, dir: string): PaperRecord {
  return { id, title: `Title ${id}`, path: `${dir}/${id}`, citeKey: `key-${id}`, status: "unread" };
}

let disposePrevious: (() => void) | null = null;

function mountForTest(pins: LibraryUiPrefs["detailsPins"] = []) {
  disposePrevious?.();
  document.body.innerHTML = "";
  const { ui, host } = createLoopbackTransport<DetailsToHost, HostToDetails>();
  const sent: DetailsToHost[] = [];
  const saved: Partial<LibraryUiPrefs>[] = [];
  host.subscribe((m) => sent.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  disposePrevious = mountDetails(container, {
    transport: ui, capabilities: {}, labels: LABELS,
    prefs: { load: () => ({ ...DEFAULT_PREFS, detailsPins: pins }), save: (patch) => { saved.push(patch); } },
  });
  const library = (msg: HostToUi): void => host.post({ channel: "library", msg });
  const snapshot = (papers: PaperRecord[]): void =>
    library({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders: [], papers, pdfDirs: [], stats: {} })) });
  const show = (target: DetailsTarget): void => host.post({ type: "details.show", target });
  const slot = (kind: "paper" | "project"): HTMLElement => container.querySelector<HTMLElement>(`.ls-details-${kind}`)!;
  const shown = (el: HTMLElement): boolean => !el.hidden;
  const empty = (): HTMLElement => container.querySelector<HTMLElement>(".ls-details-empty")!;
  const tabs = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.ls-details-tabbar [role="tab"]')];
  const labels = (): string[] => tabs().map((t) => t.textContent ?? "");
  const activeLabel = (): string | undefined => tabs().find((t) => t.getAttribute("aria-selected") === "true")?.textContent ?? undefined;
  const strip = (): HTMLElement => container.querySelector<HTMLElement>(".ls-details-tabbar")!;
  const title = (): string | null | undefined => slot("paper").querySelector(".detail-title")?.textContent;
  const button = (label: string): HTMLElement => container.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!;
  return { host, sent, saved, container, library, snapshot, show, slot, shown, empty, tabs, labels, activeLabel, strip, title, button };
}

const papers = [paper("a", "papers/A"), paper("b", "papers/A")];

describe("mountDetails", () => {
  it("roots itself in a .ls-details element and says ready on both channels", () => {
    const t = mountForTest();
    expect(t.container.querySelector(".ls-details")).not.toBeNull();
    expect(t.sent).toEqual([{ channel: "library", msg: { type: "ready" } }, { channel: "projects", msg: { type: "ready" } }]);
  });

  it("shows one empty state and hides both slots without a target", () => {
    const t = mountForTest();
    t.snapshot(papers);
    t.show(null);
    expect(t.shown(t.empty())).toBe(true);
    expect(t.empty().textContent).toContain(EMPTY);
    expect(t.empty().querySelector(".kbd-help")).toBeNull();
    expect(t.shown(t.slot("paper"))).toBe(false);
    expect(t.shown(t.slot("project"))).toBe(false);
  });

  it("shows the paper target, ignoring ids the library does not hold", () => {
    const t = mountForTest();
    t.snapshot(papers);
    t.show({ kind: "paper", ids: ["a", "gone"] });
    expect(t.shown(t.slot("paper"))).toBe(true);
    expect(t.shown(t.empty())).toBe(false);
    expect(t.slot("paper").querySelector(".detail-title")?.textContent).toBe("Title a");
    expect(t.sent).toContainEqual({ channel: "library", msg: { type: "paper.details", id: "a" } });
  });

  it("shows a paper target that arrives before the first snapshot", () => {
    const t = mountForTest();
    t.show({ kind: "paper", ids: ["b"] });
    expect(t.shown(t.empty())).toBe(true);
    t.snapshot(papers);
    expect(t.slot("paper").querySelector(".detail-title")?.textContent).toBe("Title b");
  });

  it("asks the host to open the paper's folder in the list", () => {
    const t = mountForTest();
    t.snapshot(papers);
    t.show({ kind: "paper", ids: ["a"] });
    t.slot("paper").querySelector<HTMLElement>('[data-action="goFolder"]')!.click();
    expect(t.sent).toContainEqual({ channel: "library", msg: { type: "folder.open", folder: "papers/A" } });
    expect(t.slot("paper").querySelector(".detail-title")?.textContent).toBe("Title a");
  });

  it("keeps its paper target when list-only messages arrive", () => {
    const t = mountForTest();
    t.snapshot(papers);
    t.show({ kind: "paper", ids: ["a"] });
    t.library({ type: "navigate", folder: "papers/B" });
    t.library({ type: "select", id: "b" });
    t.library({ type: "reveal", id: "b" });
    expect(t.slot("paper").querySelector(".detail-title")?.textContent).toBe("Title a");
  });

  it("shows the project target and asks for its detail", () => {
    const t = mountForTest();
    t.show({ kind: "project", id: row.id });
    expect(t.sent).toContainEqual({ channel: "projects", msg: { type: "detail", id: row.id } });
    expect(t.shown(t.empty())).toBe(true);
    t.host.post({ channel: "projects", msg: { type: "projects", rows: [row], commands: [], newKinds: [], openLabel: "Open" } });
    expect(t.shown(t.slot("project"))).toBe(true);
    expect(t.shown(t.slot("paper"))).toBe(false);
    expect(t.slot("project").querySelector(".detail-title")?.textContent).toBe(row.title);
  });

  describe("tabs", () => {
    it("hides the strip with nothing to show and shows an italic preview that follows the targets", () => {
      const t = mountForTest();
      t.snapshot(papers);
      expect(t.strip().hidden).toBe(true);
      t.show({ kind: "paper", ids: ["a"] });
      expect(t.strip().hidden).toBe(false);
      expect(t.labels()).toEqual(["Title a"]);
      expect(t.tabs()[0]!.classList.contains("preview")).toBe(true);
      t.show({ kind: "paper", ids: ["b"] });
      expect(t.labels()).toEqual(["Title b"]);
      t.show(null);
      expect(t.strip().hidden).toBe(true);
    });

    it("keeps a pinned paper while the preview moves on, and saves the pin", () => {
      const t = mountForTest();
      t.snapshot(papers);
      t.show({ kind: "paper", ids: ["a"] });
      t.button("Pin Title a").click();
      expect(t.saved).toContainEqual({ detailsPins: [{ kind: "paper", id: "a" }] });
      expect(t.labels()).toEqual(["Title a"]);
      expect(t.tabs()[0]!.classList.contains("preview")).toBe(false);
      t.show({ kind: "paper", ids: ["b"] });
      expect(t.labels()).toEqual(["Title a", "Title b"]);
      expect(t.activeLabel()).toBe("Title b");
      t.tabs()[0]!.click();
      expect(t.title()).toBe("Title a");
      expect(t.tabs()[0]!.tabIndex).toBe(0);
      expect(t.tabs()[1]!.tabIndex).toBe(-1);
    });

    it("pins the preview on double-click and activates a pinned tab when its item is selected again", () => {
      const t = mountForTest();
      t.snapshot(papers);
      t.show({ kind: "paper", ids: ["a"] });
      t.tabs()[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      t.show({ kind: "paper", ids: ["b"] });
      t.show({ kind: "paper", ids: ["a"] });
      expect(t.labels()).toEqual(["Title a", "Title b"]);
      expect(t.activeLabel()).toBe("Title a");
      expect(t.title()).toBe("Title a");
    });

    it("closes a pinned tab to its neighbour and saves the rest", () => {
      const t = mountForTest([{ kind: "paper", id: "a" }, { kind: "paper", id: "b" }]);
      t.snapshot(papers);
      t.tabs()[0]!.click();
      t.button("Close Title a").click();
      expect(t.saved).toContainEqual({ detailsPins: [{ kind: "paper", id: "b" }] });
      expect(t.labels()).toEqual(["Title b"]);
      expect(t.activeLabel()).toBe("Title b");
      expect(t.title()).toBe("Title b");
    });

    it("loads pins from the prefs, labels them when data arrives and drops a paper the snapshot lacks", () => {
      const t = mountForTest([{ kind: "paper", id: "a" }, { kind: "paper", id: "gone" }, { kind: "project", id: row.id }]);
      expect(t.labels()).toEqual(["Paper", "Paper", "Project"]);
      t.snapshot(papers);
      expect(t.labels()).toEqual(["Title a", "Project"]);
      expect(t.saved).toContainEqual({ detailsPins: [{ kind: "paper", id: "a" }, { kind: "project", id: row.id }] });
      t.host.post({ channel: "projects", msg: { type: "projects", rows: [row], commands: [], newKinds: [], openLabel: "Open" } });
      expect(t.labels()).toEqual(["Title a", row.title]);
      t.host.post({ channel: "projects", msg: { type: "projects", rows: [], commands: [], newKinds: [], openLabel: "Open" } });
      expect(t.labels()).toEqual(["Title a"]);
    });

    it("offers no pin for several papers and shows the empty state under the strip when the preview is empty", () => {
      const t = mountForTest([{ kind: "paper", id: "a" }]);
      t.snapshot(papers);
      t.show({ kind: "paper", ids: ["a", "b"] });
      expect(t.labels()).toEqual(["Title a", "2 papers"]);
      expect(t.container.querySelector(".ls-details-tab-pin")).toBeNull();
      t.show(null);
      expect(t.strip().hidden).toBe(false);
      expect(t.shown(t.empty())).toBe(true);
    });

    it("moves focus between tabs with the arrow keys and activates with Enter", () => {
      const t = mountForTest([{ kind: "paper", id: "a" }, { kind: "paper", id: "b" }]);
      t.snapshot(papers);
      t.tabs()[0]!.focus();
      t.tabs()[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      expect(document.activeElement).toBe(t.tabs()[1]);
      t.tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(t.activeLabel()).toBe("Title b");
      expect(document.activeElement).toBe(t.tabs()[1]);
    });
  });
});
