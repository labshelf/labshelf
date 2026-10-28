/** @jest-environment jsdom */
/**
 * Tests the task item node view of the Markdown item editor: the checkbox reflects and toggles `checked`.
 */
import type { EditorView } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { createTaskItemView } from "../../../src/qmd/dom/inlineViews";
import { mount, para, text } from "../../support/nodeViewHarness";

function taskDoc(checked: boolean): PmNode {
  return s.node("doc", null, [
    s.node("bullet_list", null, [s.node("task_item", { checked, mark: "x" }, [para(text("write tests"))])]),
  ]);
}

const taskItem = (view: EditorView): PmNode => view.state.doc.firstChild!.firstChild!;

describe("task item view", () => {
  it("4.3a shows an unchecked task as an unchecked checkbox and a checked one as checked", () => {
    const open = mount(taskDoc(false), { task_item: createTaskItemView() });
    expect(open.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
    const done = mount(taskDoc(true), { task_item: createTaskItemView() });
    expect(done.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
  });

  it("4.3a toggles checked in the document when the checkbox is clicked", () => {
    const view = mount(taskDoc(false), { task_item: createTaskItemView() });
    const box = view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    expect(taskItem(view).attrs.checked).toBe(true);
    expect(taskItem(view).textContent).toBe("write tests");
  });

  it("4.3a toggles checked back when the checkbox is clicked again", () => {
    const view = mount(taskDoc(true), { task_item: createTaskItemView() });
    view.dom.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(taskItem(view).attrs.checked).toBe(false);
  });
});
