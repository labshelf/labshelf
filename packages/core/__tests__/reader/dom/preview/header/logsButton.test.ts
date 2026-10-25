/**
 * @jest-environment jsdom
 */
// Tests the header logs button: problem count, hidden count at zero, menu entries and their messages.
import { mountLogsButton } from "../../../../../src/reader/dom/preview/header/index";
import type { PreviewProblem, PreviewBuildRoot, PreviewBuildRoots } from "../../../../../src/reader/index";

const root = (path: string, problems: PreviewProblem[], rawLog = false): PreviewBuildRoot =>
  ({ path, failed: false, rawLog, sourceLinks: true, problems });

const roots = (shown: string, list: PreviewBuildRoot[]): PreviewBuildRoots =>
  ({ main: list[0]!.path, focused: shown, shown, roots: list });

const PROBLEMS: PreviewProblem[] = [
  { severity: "info", message: "Package loaded" },
  { severity: "error", message: "Undefined control sequence", file: "intro.tex", line: 12 },
  { severity: "warning", message: "Overfull hbox" },
];

function setup() {
  const post = jest.fn();
  const openLogs = jest.fn();
  const slot = document.createElement("span");
  slot.hidden = true;
  document.body.replaceChildren(slot);
  const logs = mountLogsButton(slot, { post, openLogs });
  const button = () => slot.querySelector<HTMLButtonElement>("button")!;
  const count = () => slot.querySelector<HTMLElement>(".rd-logs-count")!;
  const items = () => [...document.querySelectorAll<HTMLButtonElement>(".rd-menu-item")];
  const item = (text: string) => items().find((b) => b.textContent?.includes(text))!;
  return { logs, post, openLogs, slot, button, count, items, item };
}

describe("mountLogsButton", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows the slot and counts errors and warnings of the shown root, not info", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS)]));
    expect(t.slot.hidden).toBe(false);
    expect(t.count().textContent).toBe("2");
    expect(t.count().hidden).toBe(false);
    expect(t.button().getAttribute("aria-label")).toBe("Logs, 2 problems");
  });

  it("hides the count at zero problems", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", [PROBLEMS[0]!])]));
    expect(t.count().hidden).toBe(true);
    expect(t.button().getAttribute("aria-label")).toBe("Logs");
  });

  it("follows the shown root", () => {
    const t = setup();
    const list = [root("a.tex", PROBLEMS), root("b.tex", [PROBLEMS[1]!])];
    t.logs.setRoots(roots("a.tex", list));
    t.logs.setRoots(roots("b.tex", list));
    expect(t.count().textContent).toBe("1");
    expect(t.button().getAttribute("aria-label")).toBe("Logs, 1 problem");
  });

  it("posts openProblem with the index in the full problem list", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    expect(t.items().map((b) => b.textContent)).toEqual([
      "Undefined control sequenceintro.tex:12",
      "Overfull hbox",
      "Show all",
    ]);
    t.item("Overfull").click();
    expect(t.post).toHaveBeenCalledWith({ command: "openProblem", root: "a.tex", index: 2 });
  });

  it("Show all opens the logs of the shown root", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    t.item("Show all").click();
    expect(t.openLogs).toHaveBeenCalledWith("a.tex");
  });

  it("offers the raw log only when the root kept one", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS)]));
    t.button().click();
    expect(t.item("Open raw log")).toBeUndefined();
    t.button().click();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS, true)]));
    t.button().click();
    t.item("Open raw log").click();
    expect(t.post).toHaveBeenCalledWith({ command: "openRawLog", root: "a.tex" });
  });

  it("marks the count with the error tone only when an error exists", () => {
    const t = setup();
    t.logs.setRoots(roots("a.tex", [root("a.tex", PROBLEMS)]));
    expect(t.count().dataset["tone"]).toBe("error");
    t.logs.setRoots(roots("a.tex", [root("a.tex", [PROBLEMS[2]!])]));
    expect(t.count().dataset["tone"]).toBe("warning");
  });
});
