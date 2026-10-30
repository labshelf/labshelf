/** @jest-environment jsdom */
/**
 * Tests the cell run status row: hidden until the host says running, Cancel while running, the end states, the Install Python prompt,
 * and no change for a request it did not start.
 */
import { createCellRunGroup, createCellRunStatus } from "../../../src/qmd/dom/cellRunStatus";

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
