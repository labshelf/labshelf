// Deck editor text editing: one frame leaf made contenteditable, read back as allowed inline HTML (or as text for a leaf with math), committed on Enter,
// blur or an outside press, restored on Escape; Mod+B/I/U format the selection, Mod+K asks for the link input and paste inserts plain text.
import { leafInlineHtml, toggleLeafMark, type LeafMark } from "./leafFormat.js";

export interface LeafEditingCallbacks {
  /** The leaf's text changed and is committed: one setText. */
  commit(block: string, leaf: number, text: string): void;
  /** The leaf's inline markup changed and is committed: one setInline. */
  commitInline(block: string, leaf: number, html: string): void;
  /** Mod+K in an open leaf without math: the host shows its link input. */
  requestLink(): void;
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
  /** The open leaf when it takes formatting (it holds no math), or null. */
  formattable(): HTMLElement | null;
  /** While held (a link input of the host is open), losing focus does not commit the leaf. */
  hold(on: boolean): void;
}

interface Session { block: string; leaf: number; element: HTMLElement; original: string; text: string; inline: string; math: boolean }

const MARK_KEYS: Record<string, LeafMark> = { b: "b", i: "i", u: "u" };

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

type FrameListeners = Record<"dblclick" | "keydown" | "focusout" | "pointerdown" | "paste", (event: Event) => void>;

/** Replaces the selection inside the open leaf with plain text and puts the caret after it. */
function insertPlainText(element: HTMLElement, text: string): void {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
  range.deleteContents();
  const node = element.ownerDocument.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  element.normalize();
}

/** The frame document listeners: double-click outside the leaf, Enter and Escape inside it, blur and outside presses commit. */
function frameListeners(editing: LeafEditing, openElement: () => HTMLElement | null, held: () => boolean, callbacks: LeafEditingCallbacks): FrameListeners {
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
      const formattable = editing.formattable();
      const mod = key.metaKey || key.ctrlKey;
      const mark = mod && !key.shiftKey && !key.altKey ? MARK_KEYS[key.key.toLowerCase()] : undefined;
      if (formattable && mark) {
        key.preventDefault();
        toggleLeafMark(formattable, mark);
      } else if (formattable && mod && !key.shiftKey && key.key.toLowerCase() === "k") {
        key.preventDefault();
        callbacks.requestLink();
      } else if (key.key === "Enter" && !key.shiftKey) {
        key.preventDefault();
        editing.commit();
      } else if (key.key === "Escape") {
        key.preventDefault();
        editing.cancel();
      }
    },
    focusout(event) {
      const element = openElement();
      if (element && event.target === element && !held()) editing.commit();
    },
    paste(event) {
      const target = event.target;
      if (!isNode(target) || !editing.contains(target)) return;
      event.preventDefault();
      const data = (event as ClipboardEvent).clipboardData;
      insertPlainText(openElement()!, data?.getData("text/plain") ?? "");
    },
    pointerdown(event) {
      if (openElement() && !editing.contains(isNode(event.target) ? event.target : null)) editing.commit();
    },
  };
}

/** Reports a closed session's content: nothing changed, a plain text edit, or inline markup. */
function commitSession(open: Session, callbacks: LeafEditingCallbacks): void {
  const text = leafText(open.element);
  if (open.math) return void (text === open.text ? callbacks.closed() : callbacks.commit(open.block, open.leaf, text));
  const inline = leafInlineHtml(open.element);
  if (inline === open.inline) callbacks.closed();
  // A leaf of only text and line breaks stays a plain setText.
  else if (open.element.querySelector(":not(br)") === null) callbacks.commit(open.block, open.leaf, text);
  else callbacks.commitInline(open.block, open.leaf, inline);
}

export function createLeafEditing(callbacks: LeafEditingCallbacks): LeafEditing {
  let session: Session | null = null;
  let holding = false;

  const close = (): Session | null => {
    const open = session;
    session = null;
    holding = false;
    open?.element.removeAttribute("contenteditable");
    return open;
  };
  const contains = (node: Node | null): boolean => session !== null && node !== null && session.element.contains(node);

  const editing: LeafEditing = {
    block: () => session?.block ?? null,
    begin(element, block, leaf) {
      editing.commit();
      const math = element.querySelector("[data-math]") !== null;
      session = { block, leaf, element, original: element.innerHTML, text: leafText(element), inline: math ? "" : leafInlineHtml(element), math };
      element.setAttribute("contenteditable", "true");
      element.focus({ preventScroll: true });
    },
    commit() {
      const open = close();
      if (open) commitSession(open, callbacks);
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
      doc.addEventListener("paste", listeners.paste);
    },
    formattable: () => (session && !session.math ? session.element : null),
    hold(on) {
      holding = on && session !== null;
    },
  };
  // INVARIANT: made once, so attach on a document that already holds them adds nothing.
  const listeners = frameListeners(editing, () => session?.element ?? null, () => holding, callbacks);

  return editing;
}
