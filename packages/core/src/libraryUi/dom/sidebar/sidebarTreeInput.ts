// Opens, draws and submits the inline input that adds an item under a project tree row.
import { el } from "../../../ui/dom/index.js";
import type { SidebarState } from "./sidebarView.js";

/** Whether an event comes from an inline add input, whose keys and clicks the tree must not take. */
export const isTreeInput = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement && target.classList.contains("tree-add-input");

/** Opens the input under the row `key`, or at the tree's end when no row has it. */
export function openTreeInput(t: SidebarState, view: string, key: string, placeholder: string, render: () => void): void {
  t.treeInput = { view, key, placeholder, text: "" };
  render();
}

function close(t: SidebarState, render: () => void): void {
  t.treeInput = null;
  render();
}

/** The input row; Enter sends a non-blank text, Escape or leaving it empty closes it. */
export function renderTreeInputRow(t: SidebarState, depth: number, render: () => void): HTMLElement {
  const state = t.treeInput!;
  const input = el("input", {
    class: "tree-add-input", type: "text", placeholder: state.placeholder, "aria-label": state.placeholder, maxlength: "500", value: state.text,
  }) as HTMLInputElement;
  input.addEventListener("input", () => { state.text = input.value; });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); close(t, render); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const text = input.value.trim();
    if (text) t.projects?.treeAdd(state.view, state.key, text);
    close(t, render);
  });
  // TRAP: a render replaces the input and blurs it; only a blur that leaves the input in place is the user's.
  input.addEventListener("blur", () => setTimeout(() => {
    if (input.isConnected && t.treeInput === state && input.value.trim() === "") close(t, render);
  }));
  // The row is built into a fragment, so focus waits until the render has attached it.
  queueMicrotask(() => { if (input.isConnected) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  return el("div", { class: "tree-add-row", style: `--depth:${depth}` }, input);
}
