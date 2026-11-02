// Deck editor text editing: one frame leaf made contenteditable, read back as text (br as \n, math skipped), committed on Enter, blur or an outside press, restored on Escape.
export interface LeafEditingCallbacks {
  /** The leaf's text changed and is committed: one setText. */
  commit(block: string, leaf: number, text: string): void;
  /** The leaf closed without a change (unchanged text or Escape). */
  closed(): void;
  /** A double-click in the frame document outside an open leaf. */
  doubleClick(target: Element): void;
}

export interface LeafEditing {
  /** The block of the open leaf, or null. */
  block(): string | null;
  begin(element: HTMLElement, block: string, leaf: number): void;
  commit(): void;
  cancel(): void;
  contains(node: Node | null): boolean;
  /** Listens on a frame document (again after each load; a listener already held is not added twice). */
  attach(doc: Document): void;
}

interface Session { block: string; leaf: number; element: HTMLElement; original: string; text: string }

/** The text of a leaf element: text nodes, br as \n, data-math elements left out. */
function leafText(node: Node): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) text += (child as Text).data;
    else if (child.nodeType !== 1) continue;
    else if ((child as Element).tagName.toLowerCase() === "br") text += "\n";
    else if (!(child as Element).hasAttribute("data-math")) text += leafText(child);
  }
  return text;
}

const isNode = (target: EventTarget | null): target is Node => target !== null && typeof (target as Node).nodeType === "number";

type FrameListeners = Record<"dblclick" | "keydown" | "focusout" | "pointerdown", (event: Event) => void>;

/** The frame document listeners: double-click outside the leaf, Enter and Escape inside it, blur and outside presses commit. */
function frameListeners(editing: LeafEditing, openElement: () => HTMLElement | null, callbacks: LeafEditingCallbacks): FrameListeners {
  return {
    dblclick(event) {
      const target = event.target;
      if (!isNode(target) || editing.contains(target) || target.nodeType !== 1) return;
      callbacks.doubleClick(target as Element);
    },
    keydown(event) {
      const key = event as KeyboardEvent;
      if (!isNode(key.target) || !editing.contains(key.target)) return;
      key.stopPropagation();
      if (key.key === "Enter" && !key.shiftKey) {
        key.preventDefault();
        editing.commit();
      } else if (key.key === "Escape") {
        key.preventDefault();
        editing.cancel();
      }
    },
    focusout(event) {
      const element = openElement();
      if (element && event.target === element) editing.commit();
    },
    pointerdown(event) {
      if (openElement() && !editing.contains(isNode(event.target) ? event.target : null)) editing.commit();
    },
  };
}

export function createLeafEditing(callbacks: LeafEditingCallbacks): LeafEditing {
  let session: Session | null = null;

  const close = (): Session | null => {
    const open = session;
    session = null;
    open?.element.removeAttribute("contenteditable");
    return open;
  };
  const contains = (node: Node | null): boolean => session !== null && node !== null && session.element.contains(node);

  const editing: LeafEditing = {
    block: () => session?.block ?? null,
    begin(element, block, leaf) {
      editing.commit();
      session = { block, leaf, element, original: element.innerHTML, text: leafText(element) };
      element.setAttribute("contenteditable", "true");
      element.focus({ preventScroll: true });
    },
    commit() {
      const open = close();
      if (!open) return;
      const text = leafText(open.element);
      if (text === open.text) callbacks.closed();
      else callbacks.commit(open.block, open.leaf, text);
    },
    cancel() {
      const open = close();
      if (!open) return;
      open.element.innerHTML = open.original;
      callbacks.closed();
    },
    contains,
    attach(doc) {
      doc.addEventListener("dblclick", listeners.dblclick);
      doc.addEventListener("keydown", listeners.keydown);
      doc.addEventListener("focusout", listeners.focusout);
      doc.addEventListener("pointerdown", listeners.pointerdown);
    },
  };
  // INVARIANT: made once, so attach on a document that already holds them adds nothing.
  const listeners = frameListeners(editing, () => session?.element ?? null, callbacks);

  return editing;
}
