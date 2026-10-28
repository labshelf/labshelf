// Mounts ProseMirror views over the qmd schema in jsdom for node view tests, and destroys them after each test.
import { TextEncoder as NodeTextEncoder } from "node:util";
import { EditorState } from "prosemirror-state";
import { EditorView, type NodeViewConstructor } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../src/qmd/editor/qmdSchema";

// jsdom does not expose TextEncoder, which the code hash needs.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === "undefined") {
  Object.defineProperty(globalThis, "TextEncoder", { value: NodeTextEncoder, configurable: true });
}

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.innerHTML = "";
});

export function mount(doc: PmNode, nodeViews: Record<string, NodeViewConstructor>): EditorView {
  const host = document.createElement("div");
  document.body.append(host);
  const view = new EditorView(host, { state: EditorState.create({ doc }), nodeViews });
  views.push(view);
  return view;
}

export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
export const para = (...content: PmNode[]) => s.node("paragraph", null, content);
export const text = (value: string) => s.text(value);
