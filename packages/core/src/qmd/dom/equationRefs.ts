// Shows equation numbers: "(n)" at the right of a labelled display equation and in place of an `@eq-…` reference,
// recomputed from the document on every change and handed to the node views through node decorations.
import type { Node as ProseNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { findEquation, numberEquations } from "../equationNumbers.js";

const equationNumbersKey = new PluginKey<DecorationSet>("equationNumbers");

/** `equationNumber` is the number of a labelled display equation, or of the equation a reference points to (null: none has its label). */
interface EquationSpec { equationNumber: number | null }

function decorate(doc: ProseNode): DecorationSet {
  const equations = numberEquations(doc);
  const decorations = equations.map(({ number, pos }) => Decoration.node(pos, pos + (doc.nodeAt(pos)?.nodeSize ?? 1), {}, { equationNumber: number } satisfies EquationSpec));
  doc.descendants((node, pos) => {
    if (node.type.name !== "eq_ref") return !node.isAtom;
    const number = findEquation(equations, node.attrs.label as string)?.number ?? null;
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, { equationNumber: number } satisfies EquationSpec));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Numbers the item's labelled display equations and resolves its `@eq-…` references, live as the document changes. */
export function equationNumbersPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: equationNumbersKey,
    state: {
      init: (_config, state) => decorate(state.doc),
      apply: (tr, decorations) => (tr.docChanged ? decorate(tr.doc) : decorations),
    },
    props: { decorations: (state) => equationNumbersKey.getState(state) },
  });
}

/** The number the plugin gave the node these decorations belong to: undefined without one, null for a reference to no equation. */
export function equationNumberOf(decorations: readonly Decoration[]): number | null | undefined {
  for (const decoration of decorations) {
    const spec = decoration.spec as Partial<EquationSpec>;
    if (spec.equationNumber !== undefined) return spec.equationNumber;
  }
  return undefined;
}

class EquationRefView implements NodeView {
  readonly dom: HTMLElement;

  constructor(private node: ProseNode, private readonly view: EditorView, decorations: readonly Decoration[], private readonly reveal: (view: EditorView, pos: number) => void) {
    this.dom = renderElement("span", { class: "qmd-eq-ref", contenteditable: "false" });
    // A plain click follows the reference, as it opens an internal link.
    this.dom.addEventListener("click", (event) => {
      const target = findEquation(numberEquations(this.view.state.doc), this.label);
      if (!target) return;
      event.preventDefault();
      this.reveal(this.view, target.pos);
    });
    this.render(equationNumberOf(decorations) ?? null);
  }

  private get label(): string {
    return this.node.attrs.label as string;
  }

  private render(number: number | null): void {
    this.dom.classList.toggle("is-unknown", number === null);
    this.dom.textContent = number === null ? `@${this.label}` : `(${number})`;
    this.dom.title = number === null ? `No equation has the label ${this.label}` : `Equation ${this.label}`;
  }

  update(node: ProseNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(equationNumberOf(decorations) ?? null);
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

/** A node view for `eq_ref`: "(n)" like `\eqref`, or the `@eq-…` source in the error colour when no equation has its label; a click calls `reveal` with the equation's position. */
export function createEquationRefView(reveal: (view: EditorView, pos: number) => void): NodeViewConstructor {
  return (node, view, _getPos, decorations) => new EquationRefView(node, view, decorations, reveal);
}
