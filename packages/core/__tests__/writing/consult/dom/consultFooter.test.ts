/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Tests the consult footer: a CodeMirror bottom panel with a Consult button and one chip per open floating window (title, close button), that follows the
// manager's changes, stays the lowest bottom panel, and stops listening when the editor is destroyed.
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, showPanel } from "@codemirror/view";
import { createFloatingWindows, type FloatingWindows } from "../../../../src/ui/dom/widgets/floatingWindow";
import { createConsultFooter } from "../../../../src/writing/consult/dom/consultFooter";

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); } };

let root: HTMLElement;
let windows: FloatingWindows;
let view: EditorView | undefined;

function mount(extensions: Extension[]): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc: "text", extensions }) });
  return view;
}

const footer = (): HTMLElement | null => document.querySelector<HTMLElement>(".cm-panels-bottom .ls-consult-footer");
const chips = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".ls-consult-footer .ls-consult-chip")];
const consultButton = (): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>(".ls-consult-footer button")].find((each) => each.textContent?.trim() === "Consult");
const closeButton = (title: string): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>(`.ls-consult-chip button[aria-label="Close ${title}"]`);

/** What a click on the chip's title reaches: the innermost element holding the title text, so a chip made of one button or of several parts both answer. */
function titleTarget(chip: HTMLElement, title: string): HTMLElement {
  const leaf = [...chip.querySelectorAll<HTMLElement>("*")].find((each) => each.children.length === 0 && each.textContent === title && !each.closest("[aria-label^='Close ']"));
  return leaf ?? chip;
}

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  windows = createFloatingWindows({ root });
});

afterEach(async () => {
  view?.destroy();
  view = undefined;
  await windows.closeAll();
  document.body.replaceChildren();
});

describe("createConsultFooter", () => {
  it("8.3-f renders .ls-consult-footer in the editor's bottom panels with a Consult button that calls onConsult", () => {
    const onConsult = jest.fn();
    mount([createConsultFooter({ windows, onConsult })]);
    expect(footer()).not.toBeNull();
    const button = consultButton();
    expect(button).toBeDefined();
    expect(onConsult).not.toHaveBeenCalled();
    button!.click();
    expect(onConsult).toHaveBeenCalledTimes(1);
  });

  it("8.3-f renders no chip while no floating window is open", () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    expect(chips()).toHaveLength(0);
  });

  it("8.3-f renders one chip per open floating window with its title, in open order", () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    windows.open({ kind: "paper", title: "Smith 2020" });
    windows.open({ kind: "code", title: "fit.py" });
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual(["Smith 2020", "fit.py"]);
  });

  it("8.3-f shows chips for the windows already open when the footer mounts", () => {
    windows.open({ kind: "paper", title: "Smith 2020" });
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual(["Smith 2020"]);
  });

  it("8.3-f a chip click calls bringIntoView of its window and no other", () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    const first = windows.open({ kind: "paper", title: "Smith 2020" });
    const second = windows.open({ kind: "code", title: "fit.py" });
    const bringFirst = jest.spyOn(first, "bringIntoView");
    const bringSecond = jest.spyOn(second, "bringIntoView");
    titleTarget(chips()[0]!, "Smith 2020").click();
    expect(bringFirst).toHaveBeenCalledTimes(1);
    expect(bringSecond).not.toHaveBeenCalled();
  });

  it("8.3-f a chip's x button closes its window and the chip disappears, without bringing the window into view", async () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    const first = windows.open({ kind: "paper", title: "Smith 2020" });
    const second = windows.open({ kind: "code", title: "fit.py" });
    const bringFirst = jest.spyOn(first, "bringIntoView");
    const x = closeButton("Smith 2020");
    expect(x).not.toBeNull();
    x!.click();
    await flush();
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(false);
    expect(bringFirst).not.toHaveBeenCalled();
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual(["fit.py"]);
  });

  it("8.3-f the chip of a window closed elsewhere disappears", async () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    const win = windows.open({ kind: "paper", title: "Smith 2020" });
    await win.close();
    await flush();
    expect(chips()).toHaveLength(0);
  });

  it("8.3-f a chip follows its window's title", () => {
    mount([createConsultFooter({ windows, onConsult: jest.fn() })]);
    const win = windows.open({ kind: "paper", title: "Smith 2020" });
    win.title = "Smith 2020 (notes)";
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual(["Smith 2020 (notes)"]);
    expect(closeButton("Smith 2020 (notes)")).not.toBeNull();
  });

  it("8.3-f removes its onChange listener when the view is destroyed", () => {
    const unsubscribed = jest.fn();
    const watched: FloatingWindows = {
      ...windows,
      onChange(listener) {
        const off = windows.onChange(listener);
        return () => { unsubscribed(); off(); };
      },
    };
    mount([createConsultFooter({ windows: watched, onConsult: jest.fn() })]);
    expect(unsubscribed).not.toHaveBeenCalled();
    view!.destroy();
    view = undefined;
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it("8.3-g with a second showPanel bottom panel added after the footer extension, the footer is the last child of .cm-panels-bottom", () => {
    const other = document.createElement("div");
    other.className = "test-other-panel";
    mount([createConsultFooter({ windows, onConsult: jest.fn() }), showPanel.of(() => ({ dom: other }))]);
    const bottom = document.querySelector<HTMLElement>(".cm-panels-bottom")!;
    expect(bottom.querySelector(".test-other-panel")).not.toBeNull();
    expect(bottom.lastElementChild).toBe(footer());
  });

  it("8.3-g the footer stays last when the other panel is listed before it", () => {
    const other = document.createElement("div");
    other.className = "test-other-panel";
    mount([showPanel.of(() => ({ dom: other })), createConsultFooter({ windows, onConsult: jest.fn() })]);
    const bottom = document.querySelector<HTMLElement>(".cm-panels-bottom")!;
    expect(bottom.lastElementChild).toBe(footer());
  });
});
