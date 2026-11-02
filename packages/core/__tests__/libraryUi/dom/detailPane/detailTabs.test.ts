/**
 * @jest-environment jsdom
 */
// Tests the detail pane's tab bar and Notes tab through the mounted library UI: count badges, remembering the chosen tab, and the
// read-only note rows (a note's cells are never run from the pane).
import { renderTabBarHtml } from "../../../../src/libraryUi/dom/detailPane/detailTabs";
import { ALL_CAPABILITIES, mountForTest, paper } from "../mountHarness";

const CELLED = "Intro\n\n```{python}\n#| label: calc\nprint(1)\n```\n";
const notes = [
  { id: "n1", anchor: "", body: CELLED, created: "2026-10-01T00:00:00.000Z", author: "Ana" },
  { id: "n2", anchor: "", body: "   ", created: "2026-10-02T00:00:00.000Z", author: "Ana" },
];

function open(canRunCells: boolean) {
  const t = mountForTest({ detailTab: "notes" }, ALL_CAPABILITIES);
  t.snapshot([paper("a", "papers")], ["papers/a"]);
  t.host.post({ type: "select", id: "a" });
  t.host.post({ type: "details", id: "a", details: { annotations: [], reading: null, pdf: null, notes, canRunCells }, canRunCells } as never);
  return t;
}

describe("renderTabBarHtml", () => {
  it("marks the active tab and shows a badge only where there is a count", () => {
    const root = document.createElement("div");
    root.innerHTML = renderTabBarHtml([{ id: "a", label: "A", badge: "2" }, { id: "b", label: "B" }], "b");
    const [a, b] = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    expect(a!.querySelector(".tab-badge")?.textContent).toBe("2");
    expect(b!.querySelector(".tab-badge")).toBeNull();
    expect(a!.getAttribute("aria-selected")).toBe("false");
    expect(b!.getAttribute("aria-selected")).toBe("true");
  });
});

describe("paper tabs", () => {
  it("counts the non-empty notes in the Notes tab badge and shows a row for each", () => {
    const t = open(true);
    expect(t.detail().querySelector('[data-tab="notes"] .tab-badge')?.textContent).toBe("1");
    expect(t.detail().querySelectorAll(".note-row")).toHaveLength(1);
  });

  it("remembers the tab the user picks", () => {
    const t = open(true);
    t.click('[data-tab="annotations"]', t.detail());
    expect(t.saved).toContainEqual({ detailTab: "annotations" });
  });

  it("shows a note with cells as a read-only row with no editor, Run button or note bar, even when the host can run cells", () => {
    const t = open(true);
    const row = t.detail().querySelector(".note-row")!;
    expect(row.querySelector(".note-row-title")?.textContent).toBe("Intro");
    expect(t.detail().querySelector(".ProseMirror, [contenteditable], textarea, .qmd-note-bar")).toBeNull();
    expect([...t.detail().querySelectorAll("button")].some((b) => /run|cancel|restart/i.test(`${b.textContent} ${b.getAttribute("aria-label")}`))).toBe(false);
    expect(t.sent.some((m) => String(m.type).startsWith("paper.runCell"))).toBe(false);
  });
});
