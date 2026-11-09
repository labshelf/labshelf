/** @jest-environment jsdom */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createReviewTracking, type TrackedChange } from "../../../../src/writing/dom/sourceEditor/review.js";
import { createReviewView, reviewModeDropdown } from "../../../../src/writing/dom/sourceEditor/reviewView.js";
import { renderSourceToolbar } from "../../../../src/writing/dom/sourceEditor/toolbar.js";

const created = "2026-10-30T10:00:00.000Z";
const records: TrackedChange[] = [
  { id: "ins", kind: "insert", from: 6, to: 11, author: "Ana", created },
  { id: "del", kind: "delete", from: 0, to: 0, text: "Old ", author: "Bo", created },
];

let views: EditorView[] = [];
afterEach(() => { for (const v of views) v.destroy(); views = []; document.body.replaceChildren(); });

function setup(doc = "Hello brave world") {
  const tracking = createReviewTracking({ author: () => "Ana" });
  const accept = jest.spyOn(tracking, "accept");
  const reject = jest.spyOn(tracking, "reject");
  const review = createReviewView(tracking, { now: () => Date.parse(created) + 5 * 60_000 });
  const view = new EditorView({ state: EditorState.create({ doc, extensions: [tracking.extension, review.extension] }), parent: document.body });
  views.push(view);
  return { tracking, review, view, accept, reject };
}

const panel = (view: EditorView) => view.dom.querySelector<HTMLElement>(".ls-review-panel");
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label);

describe("review view", () => {
  it("draws inserts as marks and deletes as struck-through widgets", () => {
    const { tracking, view } = setup();
    tracking.load(view, records);
    expect(view.dom.querySelector(".ls-review-insert")?.textContent).toBe("brave");
    const deleted = view.dom.querySelector(".ls-review-delete");
    expect(deleted?.textContent).toBe("Old ");
  });

  it("hides the panel while Editing with no changes and shows it while Reviewing", () => {
    const { review, view } = setup();
    expect(panel(view)).toBeNull();
    review.setMode(view, "reviewing");
    expect(panel(view)).not.toBeNull();
    review.setMode(view, "editing");
    expect(panel(view)).toBeNull();
  });

  it("shows the panel when the file has changes; Accept all and Reject all pass every id", () => {
    const { tracking, view, accept, reject } = setup();
    tracking.load(view, records);
    const p = panel(view);
    expect(p?.textContent).toContain("2 suggestions");
    button(p!, "Accept all")!.click();
    expect(accept).toHaveBeenCalledWith(view, ["del", "ins"]);
    tracking.load(view, records);
    button(panel(view)!, "Reject all")!.click();
    expect(reject).toHaveBeenCalledWith(view, ["del", "ins"]);
  });

  it("shows a tooltip for the change at the cursor whose buttons accept or reject that id", () => {
    const { tracking, view, accept, reject } = setup();
    tracking.load(view, records);
    view.dispatch({ selection: EditorSelection.cursor(8) });
    const tip = view.dom.querySelector<HTMLElement>(".ls-review-tooltip");
    expect(tip?.textContent).toContain("Ana");
    expect(tip?.textContent).toContain("5m ago");
    button(tip!, "Accept")!.click();
    expect(accept).toHaveBeenCalledWith(view, ["ins"]);
    expect(view.dom.querySelector(".ls-review-insert")).toBeNull();
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const delTip = view.dom.querySelector<HTMLElement>(".ls-review-tooltip");
    expect(delTip?.textContent).toContain("Bo");
    button(delTip!, "Reject")!.click();
    expect(reject).toHaveBeenCalledWith(view, ["del"]);
    expect(view.state.doc.toString().startsWith("Old ")).toBe(true);
  });
});

describe("review mode dropdown", () => {
  it("shows the current mode as its icon, named in the tooltip, and calls back with the picked one", () => {
    let mode: "editing" | "reviewing" = "editing";
    const pick = jest.fn((next: "editing" | "reviewing") => { mode = next; });
    const bar = renderSourceToolbar([[reviewModeDropdown(() => mode, pick)]]);
    document.body.append(bar);
    const trigger = bar.querySelector<HTMLButtonElement>(".source-editor-toolbar-dropdown")!;
    expect(trigger.textContent).toBe("");
    expect(trigger.title).toBe("Review mode: Editing");
    trigger.click();
    const items = [...document.querySelectorAll<HTMLElement>(".ls-menu-item")];
    const editing = items.find((i) => i.textContent?.includes("Edit content directly"));
    const reviewing = items.find((i) => i.textContent?.includes("Edits become suggestions"));
    expect(editing?.getAttribute("role")).toBe("menuitemradio");
    expect(editing?.getAttribute("aria-checked")).toBe("true");
    expect(reviewing?.getAttribute("aria-checked")).toBe("false");
    reviewing!.click();
    expect(pick).toHaveBeenCalledWith("reviewing");
    expect(trigger.title).toBe("Review mode: Reviewing");
  });
});

describe("toolbar right end", () => {
  it("lists the review dropdown, the icon-only Project chat button, then Share", () => {
    const chat = jest.fn();
    const bar = renderSourceToolbar([], [[
      reviewModeDropdown(() => "editing", () => undefined),
      { label: "Project chat", glyph: "message", run: chat },
      { label: "Share", glyph: "users", primary: true, run: () => undefined },
    ]]);
    const [review, chatButton, share] = [...bar.querySelectorAll<HTMLButtonElement>("button")];
    expect(review!.title).toBe("Review mode: Editing");
    expect(chatButton!.title).toBe("Project chat");
    expect(chatButton!.getAttribute("aria-label")).toBe("Project chat");
    expect(chatButton!.textContent).toBe("");
    expect(share!.textContent).toBe("Share");
    chatButton!.click();
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
