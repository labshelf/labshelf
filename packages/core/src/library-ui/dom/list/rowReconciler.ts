// Keeps a container's rows in step with an id-keyed list; rows with unchanged inputs keep their DOM node,
// so focus, hover and expansion survive a refresh.
interface Row {
  node: HTMLElement;
  inputs: readonly unknown[];
}

function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export class RowReconciler<T extends { id: string }> {
  private rows = new Map<string, Row>();

  constructor(
    private readonly container: HTMLElement,
    private readonly build: (item: T) => HTMLElement,
    /** The values a row renders from; a row is rebuilt when any of them changes identity. */
    private readonly inputsOf: (item: T) => readonly unknown[],
  ) {}

  /** Renders `items` in order, followed by `trailing` (an empty state) when given. */
  update(items: readonly T[], trailing: HTMLElement | null = null): void {
    const next = new Map<string, Row>();
    for (const item of items) {
      const inputs = this.inputsOf(item);
      const prev = this.rows.get(item.id);
      next.set(item.id, { node: prev && sameInputs(prev.inputs, inputs) ? prev.node : this.build(item), inputs });
    }
    // Stale nodes go first, so the walk below meets only kept nodes and moves one only when the order changed.
    const nodes = [...next.values()].map((r) => r.node);
    const kept = new Set<Element>(nodes);
    for (const child of [...this.container.children]) if (!kept.has(child)) child.remove();
    let cursor: ChildNode | null = this.container.firstChild;
    for (const node of nodes) {
      if (node === cursor) cursor = cursor.nextSibling;
      else this.container.insertBefore(node, cursor);
    }
    if (trailing) this.container.append(trailing);
    this.rows = next;
  }

  /** The node showing `id`, if it is rendered. */
  nodeFor(id: string): HTMLElement | undefined {
    return this.rows.get(id)?.node;
  }
}
