// The shared base of the node views that show a block kept as one `raw` attribute: it follows the node and redraws when `raw` changes.
import type { Node as ProseNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";

export abstract class RawNodeView implements NodeView {
  abstract readonly dom: HTMLElement;

  constructor(protected node: ProseNode) {}

  protected abstract render(): void;

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.raw !== this.node.attrs.raw;
    this.node = node;
    if (changed) this.render();
    return true;
  }

  selectNode(): void { this.dom.classList.add("ProseMirror-selectednode"); }

  deselectNode(): void { this.dom.classList.remove("ProseMirror-selectednode"); }
}
