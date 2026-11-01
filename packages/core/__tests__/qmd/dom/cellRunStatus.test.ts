/** @jest-environment jsdom */
/**
 * Tests the cell run status row: hidden until the host says running, Cancel while running, the end states, the Install Python prompt,
 * and no change for a request it did not start.
 */
import { createCellRunGroup, createCellRunStatus } from "../../../src/qmd/dom/cellRunStatus";
import * as status from "../../../src/qmd/dom/cellRunStatus";

const buttons = (el: HTMLElement): string[] => [...el.querySelectorAll("button")].map((b) => b.textContent ?? "");

describe("createCellRunStatus", () => {
  it("stays hidden on start, then shows the label and a Cancel button on running", () => {
    const cancelled: string[] = [];
    const status = createCellRunStatus({ onCancel: (id) => cancelled.push(id) });
    expect(status.el.hidden).toBe(true);
    status.start("r1", "bound", "python");
    expect(status.el.hidden).toBe(true);
    expect(buttons(status.el)).toEqual([]);
    expect(status.show("r1", "running")).toBe(true);
    expect(status.el.hidden).toBe(false);
    expect(status.el.getAttribute("role")).toBe("status");
    expect(status.el.textContent).toContain("Running bound…");
    expect(buttons(status.el)).toEqual(["Cancel"]);
    status.el.querySelector("button")!.click();
    expect(cancelled).toEqual(["r1"]);
    expect(status.owns("r1")).toBe(true);
  });

  it("ignores a state for a request it did not start", () => {
    const status = createCellRunStatus({ onCancel: () => {} });
    expect(status.show("r9", "error")).toBe(false);
    expect(status.el.hidden).toBe(true);
    status.start("r1", "", "python");
    expect(status.show("r9", "running")).toBe(false);
    expect(status.el.hidden).toBe(true);
    status.show("r1", "running");
    expect(status.el.textContent).toContain("Running cell…");
    expect(status.show("r9", "done")).toBe(false);
    expect(buttons(status.el)).toEqual(["Cancel"]);
  });

  it("hides on done and shows the error and cancelled texts without a button", () => {
    const status = createCellRunStatus({ onCancel: () => {} });
    status.start("r1", "a", "python");
    expect(status.show("r1", "done")).toBe(true);
    expect(status.el.hidden).toBe(true);
    status.start("r2", "a", "python");
    status.show("r2", "error");
    expect(status.el.textContent).toBe("The cell failed; its output shows the error.");
    expect(buttons(status.el)).toEqual([]);
    status.start("r3", "a", "python");
    status.show("r3", "cancelled");
    expect(status.el.textContent).toBe("Run cancelled.");
    expect(buttons(status.el)).toEqual([]);
  });

  it("offers Install Python on missing-python only when the view can install it", () => {
    let installs = 0;
    const withInstall = createCellRunStatus({ onCancel: () => {}, onInstallPython: () => { installs += 1; } });
    withInstall.start("r1", "a", "python");
    withInstall.show("r1", "missing");
    expect(withInstall.el.textContent).toContain("Python for calculations is not installed.");
    expect(buttons(withInstall.el)).toEqual(["Install Python"]);
    withInstall.el.querySelector("button")!.click();
    expect(installs).toBe(1);
    const without = createCellRunStatus({ onCancel: () => {} });
    without.start("r1", "a", "python");
    without.show("r1", "missing");
    expect(buttons(without.el)).toEqual([]);
  });
});

it("shows the run in the cell whose Run was pressed while it is running", () => {
  const editor = document.createElement("div");
  document.body.append(editor);
  const cell = document.createElement("div");
  cell.className = "qmd-cell is-run-requested";
  editor.append(cell);
  let request = "";
  const group = createCellRunGroup({ onCancel: () => undefined });
  group.attach("note", editor, (_label, _code, id) => { request = id; })("scale", "x\n", "python");
  group.show(request, "running");
  expect(cell.classList.contains("is-running")).toBe(true);
  group.show(request, "done");
  expect(cell.classList.contains("is-running")).toBe(false);
  expect(cell.classList.contains("is-run-requested")).toBe(false);
});

/** Tests that createCellRunGroup.show dispatches qmd-cell-ran with the run info on the run-requested cell of the row when a run ends. */
const INFO = { durationMs: 1234, warnings: ["Power::infy"] };

// show takes the run info as a third argument after the change; called through a cast so the file compiles before it.
type Show = (requestId: string, state: string, info?: unknown) => boolean;
const showOn = (group: ReturnType<typeof createCellRunGroup>): Show => (group.show as unknown as Show).bind(group);

function setup() {
  const editor = document.createElement("div");
  document.body.append(editor);
  const cell = document.createElement("div");
  cell.className = "qmd-cell is-run-requested";
  editor.append(cell);
  const other = document.createElement("div");
  other.className = "qmd-cell";
  editor.append(other);
  const group = createCellRunGroup({ onCancel: () => undefined });
  const ids: string[] = [];
  const run = group.attach("note", editor, (_label, _code, id) => { ids.push(id); });
  const events: Array<{ target: EventTarget | null; detail: unknown; requested: boolean }> = [];
  const listen = (el: HTMLElement) => el.addEventListener("qmd-cell-ran", (e) => {
    events.push({ target: e.target, detail: (e as CustomEvent).detail, requested: cell.classList.contains("is-run-requested") });
  });
  listen(cell);
  listen(other);
  const parentSeen: Event[] = [];
  editor.addEventListener("qmd-cell-ran", (e) => parentSeen.push(e));
  return { group, show: showOn(group), run, ids, cell, other, events, parentSeen };
}

describe("createCellRunGroup.show qmd-cell-ran", () => {
  it("1.2d names the event qmd-cell-ran", () => {
    expect((status as unknown as Record<string, unknown>).CELL_RAN_EVENT).toBe("qmd-cell-ran");
  });

  it("1.2d dispatches the info as detail on the run-requested cell when a run is done", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running");
    expect(t.events).toEqual([]);
    expect(t.show(t.ids[0]!, "done", INFO)).toBe(true);
    expect(t.events).toHaveLength(1);
    expect(t.events[0]!.target).toBe(t.cell);
    expect(t.events[0]!.detail).toEqual(INFO);
  });

  it("1.2d dispatches before the run-requested class is removed, which still happens", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running");
    t.show(t.ids[0]!, "done", INFO);
    expect(t.events[0]!.requested).toBe(true);
    expect(t.cell.classList.contains("is-run-requested")).toBe(false);
    expect(t.cell.classList.contains("is-running")).toBe(false);
  });

  it("1.2d dispatches on an error end state too", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running");
    t.show(t.ids[0]!, "error", { durationMs: 90 });
    expect(t.events.map((e) => e.detail)).toEqual([{ durationMs: 90 }]);
  });

  it("1.2d does not bubble the event to the editor", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running");
    t.show(t.ids[0]!, "done", INFO);
    expect(t.parentSeen).toEqual([]);
  });

  it("1.2d dispatches nothing while the run is still running", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running", INFO);
    expect(t.events).toEqual([]);
  });

  it("1.2d dispatches nothing for an end state without info", () => {
    const t = setup();
    t.run("scale", "x\n", "python");
    t.show(t.ids[0]!, "running");
    t.show(t.ids[0]!, "cancelled");
    expect(t.events).toEqual([]);
  });

  it("1.2d dispatches nothing when a preview ends, and still ends the preview", () => {
    const t = setup();
    const ended: unknown[] = [];
    t.run("scale", "x\n", "python", undefined, (result) => { ended.push(result); });
    expect(t.show(t.ids[0]!, "done", INFO)).toBe(true);
    expect(ended).toEqual([undefined]);
    expect(t.events).toEqual([]);
  });

  it("1.2d dispatches nothing for a request no row started", () => {
    const t = setup();
    expect(t.show("unknown", "done", INFO)).toBe(false);
    expect(t.events).toEqual([]);
  });
});
