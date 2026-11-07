// Numbers the labelled display equations of one item body, as Quarto numbers `$$…$$ {#eq-…}`.
// CONTRACT: documents/contracts/qmd-items.md#format
import type { Node } from "prosemirror-model";

/** `pos` is the document position of the `math_display` node. */
export interface NumberedEquation { label: string; number: number; pos: number }

/** The labelled display equations of `doc` in document order, numbered from 1; an unlabelled one gets no number. Numbering is per item. */
export function numberEquations(doc: Node): NumberedEquation[] {
  const numbered: NumberedEquation[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "math_display") {
      const label = node.attrs.label as string | null;
      if (label) numbered.push({ label, number: numbered.length + 1, pos });
      return false;
    }
    return !node.isTextblock && !node.isAtom;
  });
  return numbered;
}

/** The equation an `@eq-…` reference points to: the first with its label, or undefined. */
export function findEquation(equations: readonly NumberedEquation[], label: string): NumberedEquation | undefined {
  return equations.find((equation) => equation.label === label);
}
