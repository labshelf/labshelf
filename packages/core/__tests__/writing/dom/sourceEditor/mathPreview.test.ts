/** @jest-environment jsdom */
/**
 * The source editor's math preview: above the math under an empty cursor, none in text or over a selection, Hide for now
 * until the cursor leaves that math, Never show through the host's setting, and none at all when the setting is off.
 */
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { createMathPreview, type MathPreviewSetting } from "../../../../src/writing/dom/sourceEditor/mathPreview";

const DOC = "Para todo $k \\ge 3$ existe $\\alp \\bet$ primos.";
const FIRST = DOC.indexOf("$");
const SECOND = DOC.indexOf("$\\alp");

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

function tooltipsOf(state: EditorState): Tooltip[] {
  return state.facet(showTooltip).filter((tooltip): tooltip is Tooltip => tooltip !== null);
}

function stateAt(anchor: number, extension: Extension = createMathPreview(), head = anchor): EditorState {
  return EditorState.create({ doc: DOC, selection: { anchor, head }, extensions: [extension] });
}

function mount(anchor: number, setting?: MathPreviewSetting): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent, state: stateAt(anchor, createMathPreview(setting)) });
  views.push(view);
  return view;
}

/** Picks a ⋯ menu item of the preview the view shows. */
function pick(view: EditorView, label: string): void {
  const tooltip = tooltipsOf(view.state)[0]!;
  const { dom } = tooltip.create(view);
  document.body.append(dom);
  dom.querySelector<HTMLButtonElement>(".cm-math-preview-more")!.click();
  const item = [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((element) => element.textContent?.includes(label));
  item!.click();
}

describe("math preview", () => {
  it("shows the math around the cursor above it", () => {
    expect(tooltipsOf(stateAt(DOC.indexOf("3")))).toEqual([expect.objectContaining({ pos: FIRST, end: DOC.indexOf("$ existe") + 1, above: true })]);
  });

  it("shows nothing in text or over a selection", () => {
    expect(tooltipsOf(stateAt(DOC.indexOf("existe")))).toEqual([]);
    expect(tooltipsOf(stateAt(DOC.indexOf("k"), createMathPreview(), DOC.indexOf("3")))).toEqual([]);
  });

  it("keeps the tooltip while the cursor moves inside the same math", () => {
    const state = stateAt(DOC.indexOf("k"));
    const after = state.update({ selection: { anchor: DOC.indexOf("3") } }).state;
    expect(tooltipsOf(after)[0]).toBe(tooltipsOf(state)[0]);
  });

  it("hides for now until the cursor leaves that math", () => {
    const view = mount(DOC.indexOf("3"));
    pick(view, "Hide for now");
    expect(tooltipsOf(view.state)).toEqual([]);
    view.dispatch({ selection: { anchor: DOC.indexOf("k") } });
    expect(tooltipsOf(view.state)).toEqual([]);
    view.dispatch({ selection: { anchor: SECOND + 2 } });
    expect(tooltipsOf(view.state)).toEqual([expect.objectContaining({ pos: SECOND })]);
  });

  it("turns the preview off through the setting with Never show", () => {
    const setting = { enabled: true, disable: jest.fn() };
    const view = mount(DOC.indexOf("3"), setting);
    pick(view, "Never show");
    expect(setting.disable).toHaveBeenCalledTimes(1);
    view.dispatch({ selection: { anchor: SECOND + 2 } });
    expect(tooltipsOf(view.state)).toEqual([]);
  });

  it("shows nothing when the setting is off, and offers no Never show without a setting", () => {
    expect(tooltipsOf(stateAt(DOC.indexOf("3"), createMathPreview({ enabled: false, disable: jest.fn() })))).toEqual([]);
    const view = mount(DOC.indexOf("3"));
    const { dom } = tooltipsOf(view.state)[0]!.create(view);
    document.body.append(dom);
    dom.querySelector<HTMLButtonElement>(".cm-math-preview-more")!.click();
    expect([...document.querySelectorAll(".ls-menu-item")].map((item) => item.textContent)).toEqual([expect.stringContaining("Hide for now")]);
  });
});
