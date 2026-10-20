/**
 * @jest-environment jsdom
 */
import { DEFAULT_PREFS, createLoopbackTransport, type DetailsTarget, type DetailsToHost, type HostToDetails, type HostToUi, type PaperRecord } from "@labshelf/core";
import { mountDetails } from "../../../src/details/dom";
import { row } from "../../writing/allProjects/dom/detail/fixtures";

const LABELS = { addTooltip: "Add a paper", emptyHint: "Papers come in through the Add button.", revealPaper: "Reveal in Explorer" };
const EMPTY = "Select a paper or project to see its details.";

function paper(id: string, dir: string): PaperRecord {
  return { id, title: `Title ${id}`, path: `${dir}/${id}`, citeKey: `key-${id}`, status: "unread" };
}

let disposePrevious: (() => void) | null = null;

function mountForTest() {
  disposePrevious?.();
  document.body.innerHTML = "";
  const { ui, host } = createLoopbackTransport<DetailsToHost, HostToDetails>();
  const sent: DetailsToHost[] = [];
  host.subscribe((m) => sent.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  disposePrevious = mountDetails(container, {
    transport: ui, capabilities: {}, labels: LABELS,
    prefs: { load: () => ({ ...DEFAULT_PREFS }), save: () => undefined },
  });
  const library = (msg: HostToUi): void => host.post({ channel: "library", msg });
  const snapshot = (papers: PaperRecord[]): void =>
    library({ type: "snapshot", snapshot: JSON.parse(JSON.stringify({ folders: [], papers, pdfDirs: [], stats: {} })) });
  const show = (target: DetailsTarget): void => host.post({ type: "details.show", target });
  const slot = (kind: "paper" | "project"): HTMLElement => container.querySelector<HTMLElement>(`.ls-details-${kind}`)!;
  const shown = (el: HTMLElement): boolean => el.style.display !== "none";
  const empty = (): HTMLElement => container.querySelector<HTMLElement>(".ls-details-empty")!;
  return { host, sent, container, library, snapshot, show, slot, shown, empty };
}

const papers = [paper("a", "papers/A"), paper("b", "papers/A")];

describe("mountDetails", () => {
  it("roots itself in a .ls-details.ls-library element and says ready on both channels", () => {
    const t = mountForTest();
    expect(t.container.querySelector(".ls-details.ls-library")).not.toBeNull();
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
});
