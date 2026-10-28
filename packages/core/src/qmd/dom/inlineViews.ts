// Shows the small inline and list parts of an item body: citation chips, task item checkboxes and `labshelf:` links as internal links.
import type { Mark, Node as ProseNode } from "prosemirror-model";
import type { EditorView, MarkViewConstructor, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";

/** A node view for `citation`: its `[@key]` keys as one chip; the keys are not looked up. */
export function createCitationView(): NodeViewConstructor {
  return (node) => {
    const keys = node.attrs.keys as string[];
    const dom = renderElement("span", { class: "qmd-citation", contenteditable: "false", "data-citation": keys.join(" "), text: `[${keys.map((key) => `@${key}`).join("; ")}]` });
    return { dom, ignoreMutation: () => true };
  };
}

class TaskItemView implements NodeView {
  readonly dom: HTMLElement;
  readonly contentDOM: HTMLElement;
  private readonly box: HTMLInputElement;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined) {
    this.box = renderElement("input", { class: "qmd-task-check", type: "checkbox", "aria-label": "Done" });
    this.box.disabled = !view.editable;
    this.box.addEventListener("mousedown", (event) => event.preventDefault());
    // Not cancelled: a cancelled click restores the box's old state after the transaction has set the new one.
    this.box.addEventListener("click", () => this.toggle());
    this.contentDOM = renderElement("div", { class: "qmd-task-content" });
    this.dom = renderElement("li", { class: "qmd-task" }, renderElement("span", { class: "qmd-task-box", contenteditable: "false" }, this.box), this.contentDOM);
    this.render();
  }

  private render(): void {
    const checked = this.node.attrs.checked === true;
    this.box.checked = checked;
    this.dom.dataset.task = checked ? "done" : "open";
  }

  private toggle(): void {
    if (!this.view.editable || !setViewNodeAttribute(this.view, this.getPos, "checked", this.node.attrs.checked !== true)) this.render();
  }

  stopEvent(event: Event): boolean {
    return event.target === this.box;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
}

/** A node view for `task_item`: a checkbox that reflects `checked` and toggles it through a transaction. */
export function createTaskItemView(): NodeViewConstructor {
  return (node, view, getPos) => new TaskItemView(node, view, getPos);
}

/** Sets one attribute of a node view's node through a transaction; false when the node has no position. */
export function setViewNodeAttribute(view: EditorView, getPos: () => number | undefined, name: string, value: unknown): boolean {
  const pos = getPos();
  if (pos === undefined) return false;
  view.dispatch(view.state.tr.setNodeAttribute(pos, name, value));
  return true;
}

const INTERNAL_LINK = /^labshelf:/i;

/** A mark view for `link`: a `labshelf:` href shows as an internal link with the link icon; clicks are opened by the editor's link handler. */
export function createLinkView(): MarkViewConstructor {
  return (mark: Mark) => {
    const href = mark.attrs.href as string;
    const dom = renderElement("a", { href, class: INTERNAL_LINK.test(href) ? "qmd-link qmd-link-internal" : "qmd-link" });
    if (!INTERNAL_LINK.test(href)) return { dom };
    const contentDOM = renderElement("span", { class: "qmd-link-text" });
    dom.append(renderElement("span", { class: "qmd-link-icon", contenteditable: "false", html: renderIcon("link") }), contentDOM);
    return { dom, contentDOM, ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target) };
  };
}
