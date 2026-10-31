/**
 * Shared set-up of the param strip tests (cellParamStrip.test.ts, cellParamStripManipulate.test.ts): mounts a code cell view
 * with a recording run callback, and drives its native controls. Not a test itself.
 */
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { history } from "prosemirror-history";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput } from "../../../src/qmd/item/cellOutput";
import { createCodeCellView } from "../../../src/qmd/dom/codeCellView";
import { createOutputView } from "../../../src/qmd/dom/outputView";
import "../../support/nodeViewHarness"; // jsdom TextEncoder polyfill

export const SLIDER = "#| param: speed = slider(0, 10, 5, step = 1)\n";
export const OPTIONS = `#| label: sim\n${SLIDER}`;
export const CODE = "print(speed)\n";
export const DEBOUNCE = 150;

type PreviewDone = (result: unknown) => void;
interface Call { label: string; code: string; language: string; params: unknown; preview: PreviewDone | undefined; optionsAtCall: string }

const views: EditorView[] = [];

/** Registers the fake timers and the clean-up of every mounted view; call it once at the top of a test file. */
export function useStripLifecycle(): void {
  beforeEach(() => { jest.useFakeTimers({ doNotFake: ["queueMicrotask"] }); });
  afterEach(() => {
    while (views.length > 0) views.pop()!.destroy();
    document.body.innerHTML = "";
    jest.useRealTimers();
  });
}

export function cell(options: string, lang = "python") {
  return s.node("code_cell", { lang, options, code: CODE, info: `{${lang}}` });
}

export async function resultOutput() {
  const raw = formatOutput({ cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", content: "result-text-42\n" });
  return s.node("output", { cell: "sim", source: "000000000000", engine: "python", ran: "2026-10-30", raw });
}

/** Mounts a doc with a run callback recording every call; `docChanges` counts the transactions that changed the doc. */
export function mountCell(children: ReturnType<typeof cell>[] | any[], opts: { runnable?: boolean } = {}) {
  const calls: Call[] = [];
  const state = { docChanges: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  let view!: EditorView;
  const run = (label: string, code: string, language: string, params?: unknown, preview?: PreviewDone): void => {
    calls.push({ label, code, language, params, preview, optionsAtCall: view.state.doc.firstChild!.attrs.options as string });
  };
  view = new EditorView(host, {
    state: EditorState.create({ doc: s.node("doc", null, children), plugins: [history()] }),
    nodeViews: {
      code_cell: createCodeCellView(opts.runnable === false ? undefined : (run as never)),
      output: createOutputView(async () => ({ renderMathSvg: () => "<svg></svg>" })),
    },
    dispatchTransaction(tr) {
      if (tr.docChanged) state.docChanges++;
      view.updateState(view.state.apply(tr));
    },
  });
  views.push(view);
  return {
    view,
    calls,
    state,
    previews: () => calls.filter((c) => c.preview),
    normals: () => calls.filter((c) => !c.preview),
    options: () => view.state.doc.firstChild!.attrs.options as string,
  };
}

export const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
export const OK = { status: "ok", language: "python", durationMs: 1 } as const;

/** Simulates a normal run of the cell in the view: the run status marks the cell `is-running`, then clears it. */
export async function finishNormalRun(view: EditorView): Promise<void> {
  const el = view.dom.querySelector(".qmd-cell")!;
  el.classList.add("is-running");
  await flush();
  el.classList.remove("is-running");
  el.classList.remove("is-run-requested");
  await flush();
}

export const controlsOf = (view: EditorView) => Array.from(view.dom.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[type="range"], input[type="checkbox"], select'));
export const rangeOf = (view: EditorView) => view.dom.querySelector<HTMLInputElement>('input[type="range"]')!;

export function drag(el: HTMLInputElement, value: number): void {
  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function release(el: HTMLElement): void {
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function nameOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  return Array.from((el as HTMLInputElement).labels ?? []).map((label) => label.textContent).join(" ").trim();
}
