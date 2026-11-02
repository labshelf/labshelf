/** @jest-environment jsdom */
/**
 * Tests the multi-run progress of the cell run status row: 'Running k of n' with exactly one Stop that calls the coordinator's stop,
 * cleared by null, routed by item key through the run group, and not doubled by a single-cell running row.
 */
import { createCellRunGroup, createCellRunStatus, showGroupProgress, showRunProgress } from "../../../src/qmd/dom/cellRunStatus";

const buttons = (el: HTMLElement): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>("button")];
const PROGRESS = { done: 1, total: 5, running: "second" };

describe("showRunProgress", () => {
  it("2.2c shows 'Running 2 of 5' for one cell done of five", () => {
    const status = createCellRunStatus({ onCancel: () => undefined });
    showRunProgress(status, PROGRESS, () => undefined);
    expect(status.el.hidden).toBe(false);
    expect(status.el.textContent).toContain("Running 2 of 5");
  });

  it("2.2c follows the progress: done 2 of 5 reads 'Running 3 of 5'", () => {
    const status = createCellRunStatus({ onCancel: () => undefined });
    showRunProgress(status, PROGRESS, () => undefined);
    showRunProgress(status, { done: 2, total: 5, running: "third" }, () => undefined);
    expect(status.el.textContent).toContain("Running 3 of 5");
    expect(status.el.textContent).not.toContain("Running 2 of 5");
  });

  it("2.2c shows exactly one Stop button and it calls onStop", () => {
    const status = createCellRunStatus({ onCancel: () => undefined });
    let stops = 0;
    showRunProgress(status, PROGRESS, () => { stops += 1; });
    expect(buttons(status.el).map((b) => (b.textContent ?? "").trim())).toEqual(["Stop"]);
    buttons(status.el)[0]!.click();
    expect(stops).toBe(1);
  });

  it("2.2c null clears the progress and its Stop", () => {
    const status = createCellRunStatus({ onCancel: () => undefined });
    showRunProgress(status, PROGRESS, () => undefined);
    showRunProgress(status, null);
    expect(status.el.textContent).not.toContain("Running 2 of 5");
    expect(buttons(status.el)).toEqual([]);
  });

  it("A3 a single-cell running row shown while progress is on adds no second Cancel or Stop", () => {
    let cancels = 0;
    let stops = 0;
    const status = createCellRunStatus({ onCancel: () => { cancels += 1; } });
    showRunProgress(status, PROGRESS, () => { stops += 1; });
    status.start("r1", "second", "python");
    status.show("r1", "running");
    expect(buttons(status.el)).toHaveLength(1);
    expect(status.el.textContent).toContain("Running 2 of 5");
    buttons(status.el)[0]!.click();
    expect(stops).toBe(1);
    expect(cancels).toBe(0);
  });

  it("2.2c after null the single-cell running display is back, with its Cancel", () => {
    const cancelled: string[] = [];
    const status = createCellRunStatus({ onCancel: (id) => cancelled.push(id) });
    showRunProgress(status, PROGRESS, () => undefined);
    showRunProgress(status, null);
    status.start("r1", "bound", "python");
    status.show("r1", "running");
    expect(status.el.textContent).toContain("Running bound…");
    expect(buttons(status.el).map((b) => b.textContent)).toEqual(["Cancel"]);
    buttons(status.el)[0]!.click();
    expect(cancelled).toEqual(["r1"]);
  });
});

describe("showGroupProgress", () => {
  function twoRows() {
    const group = createCellRunGroup({ onCancel: () => undefined });
    const make = (key: string): HTMLElement => {
      const editor = document.createElement("div");
      document.body.append(editor);
      group.attach(key, editor, () => undefined);
      return editor.nextElementSibling as HTMLElement;
    };
    return { group, a: make("a"), b: make("b") };
  }
  afterEach(() => { document.body.innerHTML = ""; });

  it("2.2c routes the progress to the row attached under that key only", () => {
    const { group, a, b } = twoRows();
    showGroupProgress(group, "a", PROGRESS, () => undefined);
    expect(a.textContent).toContain("Running 2 of 5");
    expect(b.textContent).not.toContain("Running");
  });

  it("2.2c Stop in the routed row calls the onStop given with the progress", () => {
    const { group, a } = twoRows();
    let stops = 0;
    showGroupProgress(group, "a", PROGRESS, () => { stops += 1; });
    expect(buttons(a)).toHaveLength(1);
    buttons(a)[0]!.click();
    expect(stops).toBe(1);
  });

  it("2.2c null through the group clears that row", () => {
    const { group, a } = twoRows();
    showGroupProgress(group, "a", PROGRESS, () => undefined);
    showGroupProgress(group, "a", null);
    expect(a.textContent).not.toContain("Running");
    expect(buttons(a)).toEqual([]);
  });

  it("2.2c a key with no row changes nothing and does not throw", () => {
    const { group, a, b } = twoRows();
    expect(() => showGroupProgress(group, "nope", PROGRESS, () => undefined)).not.toThrow();
    expect(a.textContent).not.toContain("Running");
    expect(b.textContent).not.toContain("Running");
  });
});
