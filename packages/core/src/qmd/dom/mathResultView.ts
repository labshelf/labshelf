// Shows a computed result after its inline math (`$expr =$ [$value$]{.labshelf-result}`): typeset, out of date when the math or the
// cells above it changed since it was computed, with its state and Recompute in the shared hover card; and asks the runner for one.
import type { Node as ProseNode } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { isWritableResultTex } from "../editor/index.js";
import { deriveResultSource } from "../item/index.js";
import type { CellsAbove, OnEvalMath } from "./evalMathBridge.js";
import { attachMathHoverCard, renderCardAction, type MathHoverCard } from "./mathHoverCard.js";
import { loadCoreMath, renderMathInto, type MathComputeHooks, type MathLoader } from "./mathView.js";

/** What the editor computes with: the runner and the supplier of the cells above a position. */
export interface MathCompute { onEvalMath: OnEvalMath; cellsAbove?: CellsAbove }

type MathRequest = Parameters<OnEvalMath>[0];
type MathReply = Parameters<Parameters<OnEvalMath>[1]>[0];

/** What a math asks for: `=` at its end evaluates, `\approx` at its end evaluates numerically, an equation is solved. */
interface MathAsk { op: "eval" | "numeric" | "solve"; tex: string }

/** The engine every result is computed with for now. */
const ENGINE = "mathematica";
const CHECK_DELAY_MS = 300;

/** The ask of an inline math's TeX: its trailing `=` or `\approx` stripped, or the whole equation to solve; null when it asks nothing. */
function askOfMath(tex: string): MathAsk | null {
  const trailing = /\s*(=|\\approx)\s*$/.exec(tex);
  if (trailing) {
    const expr = tex.slice(0, trailing.index).trim();
    return expr ? { op: trailing[1] === "=" ? "eval" : "numeric", tex: expr } : null;
  }
  return tex.includes("=") ? { op: "solve", tex: tex.trim() } : null;
}

/** Whether `node` is a text node of white space only, the space between a math and its result. */
function isGap(node: ProseNode | undefined | null): boolean {
  return !!node && node.isText && /^\s*$/.test(node.text ?? "");
}

/** The result following the inline math at `mathPos` (across one space), or null. */
function resultAfterMath(doc: ProseNode, mathPos: number): { pos: number; node: ProseNode } | null {
  const math = doc.nodeAt(mathPos);
  if (!math) return null;
  let pos = mathPos + math.nodeSize;
  let next = doc.resolve(pos).nodeAfter;
  if (isGap(next)) { pos += next!.nodeSize; next = doc.resolve(pos).nodeAfter; }
  return next && next.type.name === "math_result" ? { pos, node: next } : null;
}

/** The inline math the result at `resultPos` follows (across one space), or null. */
function mathBeforeResult(doc: ProseNode, resultPos: number): { pos: number; node: ProseNode } | null {
  let pos = resultPos;
  let prev = doc.resolve(pos).nodeBefore;
  if (isGap(prev)) { pos -= prev!.nodeSize; prev = doc.resolve(pos).nodeBefore; }
  return prev && prev.type.name === "math_inline" ? { pos: pos - prev.nodeSize, node: prev } : null;
}

/** A reply the editor can write: a value with LaTeX that fits the result span. */
function writableLatex(reply: MathReply): string | null {
  const { state, latex } = reply as { state: string; latex?: string };
  return state === "value" && typeof latex === "string" && latex.trim() && isWritableResultTex(latex) ? latex : null;
}

/** The reply's messages as one line, for the card. */
function replyMessage(reply: MathReply): string {
  const messages = (reply as { messages?: string[] }).messages ?? [];
  return messages.length ? messages.join(" ") : "The math could not be computed.";
}

/**
 * Asks the runner for `ask` and calls `done` with the reply and the result's `source`: the hash of the asked TeX and the cells above
 * `pos` when it was asked, so a later check sees whether either changed.
 */
function askMath(compute: MathCompute, pos: number, ask: MathAsk, done: (reply: MathReply, source: string) => void): void {
  const source = Promise.resolve(compute.cellsAbove ? compute.cellsAbove(pos) : []).then((cells) => deriveResultSource(ask.tex, [...cells]));
  const request = { op: ask.op, tex: ask.tex } as MathRequest;
  compute.onEvalMath(request, (reply) => { void source.then((hash) => done(reply, hash), () => undefined); });
}

/**
 * Asks for the result of the inline math at `getPos()` and inserts it after the math, one space between, in one undoable step.
 * The reply is dropped when the math changed meanwhile, a result already follows it, or it carries no writable value.
 */
function insertMathResult(view: EditorView, compute: MathCompute, getPos: () => number | undefined, ask: MathAsk, onFail?: (message: string) => void): void {
  const pos = getPos();
  if (pos === undefined) return;
  const asked = view.state.doc.nodeAt(pos)?.attrs.tex as string | undefined;
  askMath(compute, pos, ask, (reply, source) => {
    const at = getPos();
    const math = at === undefined ? null : view.state.doc.nodeAt(at);
    if (at === undefined || !math || math.type.name !== "math_inline" || math.attrs.tex !== asked || resultAfterMath(view.state.doc, at)) return;
    const latex = writableLatex(reply);
    if (latex === null) { onFail?.(replyMessage(reply)); return; }
    const { schema } = view.state;
    const result = schema.nodes.math_result!.create({ tex: latex, engine: ENGINE, source });
    view.dispatch(view.state.tr.insert(at + math.nodeSize, [schema.text(" "), result]));
  });
}

/**
 * The math view's compute actions over `compute` (D8): leaving a math that ends with `=` or `\approx` inserts its result unless one
 * already follows (a result is never recomputed on its own), and an equation offers Solve.
 */
export function createMathComputeHooks(compute: MathCompute): MathComputeHooks {
  const askAt = (view: EditorView, getPos: () => number | undefined): MathAsk | null => {
    const pos = getPos();
    const math = pos === undefined ? null : view.state.doc.nodeAt(pos);
    if (pos === undefined || !math || math.type.name !== "math_inline" || !view.editable || resultAfterMath(view.state.doc, pos)) return null;
    return askOfMath(math.attrs.tex as string);
  };
  return {
    leave(view, getPos) {
      const ask = askAt(view, getPos);
      if (ask && ask.op !== "solve") insertMathResult(view, compute, getPos, ask);
    },
    canSolve: (view, getPos) => askAt(view, getPos)?.op === "solve",
    solve(view, getPos, onFail) {
      const ask = askAt(view, getPos);
      if (ask?.op === "solve") insertMathResult(view, compute, getPos, ask, onFail);
    },
  };
}

/** The result views of each editor, told when its document changes so they check whether they are out of date. */
const resultViews = new WeakMap<EditorView, Set<MathResultView>>();

/** Tells an editor's result views that its document changed. */
export function mathResultPlugin(): Plugin {
  return new Plugin({
    view: () => ({
      update(view, prev) {
        if (view.state.doc.eq(prev.doc)) return;
        for (const result of resultViews.get(view) ?? []) result.scheduleCheck();
      },
    }),
  });
}

type ResultState = "current" | "out-of-date" | "computing" | "failed";

/**
 * A result typeset in the sentence. With a runner it is checked against its math and the cells above (out of date shows dimmed
 * with a worded state and Recompute in the card); Recompute replaces it in one undoable step. Without one it only shows.
 */
class MathResultView implements NodeView {
  readonly dom: HTMLElement;
  private readonly rendered: HTMLElement;
  private readonly card: MathHoverCard;
  private state: ResultState = "current";
  private failure = "";
  private renderToken = 0;
  private checkToken = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly compute: MathCompute | undefined, private readonly loadMath: MathLoader) {
    this.dom = renderElement("span", { class: "qmd-math-result", tabindex: "0", "aria-label": "Computed result" });
    this.rendered = renderElement("span", { class: "qmd-math-result-rendered" });
    this.dom.append(this.rendered);
    this.card = attachMathHoverCard(this.dom, "Result", () => this.cardContent());
    if (compute?.cellsAbove) {
      let views = resultViews.get(view);
      if (!views) resultViews.set(view, views = new Set());
      views.add(this);
    }
    this.render();
    this.scheduleCheck(0);
  }

  private render(): void {
    const token = ++this.renderToken;
    const tex = this.node.attrs.tex as string;
    this.dom.classList.toggle("is-invalid", !isWritableResultTex(tex));
    void renderMathInto(this.rendered, tex, false, this.loadMath).then((error) => {
      if (token === this.renderToken) this.dom.classList.toggle("is-invalid", error !== null || !isWritableResultTex(tex));
    });
  }

  private setState(state: ResultState, failure = ""): void {
    this.state = state;
    this.failure = failure;
    this.dom.classList.toggle("is-out-of-date", state === "out-of-date" || state === "failed");
    this.dom.classList.toggle("is-computing", state === "computing");
    this.dom.setAttribute("aria-busy", String(state === "computing"));
    this.card.refresh();
  }

  /** The card: how the result was computed, and when it is out of date the words saying so with Recompute. */
  private cardContent(): HTMLElement[] {
    const engine = String(this.node.attrs.engine || ENGINE);
    const content = [renderElement("span", { class: "qmd-math-card-text", text: `Computed with ${engine.charAt(0).toUpperCase()}${engine.slice(1)}` })];
    if (this.state === "computing") content.push(renderElement("span", { class: "qmd-math-card-text", role: "status", text: "Computing…" }));
    if (this.state === "out-of-date" || this.state === "failed") {
      const words = this.state === "failed" ? `Out of date — recomputing failed: ${this.failure}` : "Out of date — the math or the cells above changed";
      content.push(renderElement("span", { class: "qmd-math-card-text qmd-math-card-warning", role: "note", text: words }));
      if (this.compute && this.view.editable) content.push(renderCardAction("Recompute", () => this.recompute()));
    }
    return content;
  }

  /** The ask of the math this result follows, or null when it follows none that asks. */
  private ask(): { ask: MathAsk; mathPos: number } | null {
    const pos = this.getPos();
    if (pos === undefined) return null;
    const math = mathBeforeResult(this.view.state.doc, pos);
    const ask = math && askOfMath(math.node.attrs.tex as string);
    return math && ask ? { ask, mathPos: math.pos } : null;
  }

  /** Checks again after the document settles (`delay` ms). */
  scheduleCheck(delay = CHECK_DELAY_MS): void {
    if (!this.compute?.cellsAbove || this.destroyed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.check(); }, delay);
  }

  /** Out of date when the math's TeX and the cells above hash to something other than the stored `source`. */
  private async check(): Promise<void> {
    const cellsAbove = this.compute?.cellsAbove;
    const pos = this.getPos();
    if (!cellsAbove || pos === undefined || this.destroyed || this.state === "computing") return;
    const token = ++this.checkToken;
    const asked = this.ask();
    const source = this.node.attrs.source as string;
    if (!asked) { this.setState("current"); return; }
    try {
      const hash = await deriveResultSource(asked.ask.tex, [...await cellsAbove(pos)]);
      // Recompute bumps the token, so a check it overtook is dropped here.
      if (token !== this.checkToken || this.destroyed) return;
      if (hash === source) this.setState("current");
      else if (this.state !== "failed") this.setState("out-of-date");
    } catch { /* a supplier that fails leaves the state as it is */ }
  }

  /** Asks again and replaces this result with the answer in one undoable step; a reply after the math or result changed is dropped. */
  private recompute(): void {
    const asked = this.ask();
    const compute = this.compute;
    if (!asked || !compute || this.state === "computing") return;
    const before = this.node;
    const mathTex = this.view.state.doc.nodeAt(asked.mathPos)?.attrs.tex;
    this.checkToken++;
    this.setState("computing");
    askMath(compute, asked.mathPos, asked.ask, (reply, source) => {
      if (this.destroyed) return;
      const pos = this.getPos();
      const now = pos === undefined ? null : mathBeforeResult(this.view.state.doc, pos);
      if (pos === undefined || this.node !== before || now?.node.attrs.tex !== mathTex) { this.setState("current"); this.scheduleCheck(0); return; }
      const latex = writableLatex(reply);
      if (latex === null) { this.setState("failed", replyMessage(reply)); return; }
      const next = this.view.state.schema.nodes.math_result!.create({ ...before.attrs, tex: latex, source });
      this.state = "current";
      this.view.dispatch(this.view.state.tr.replaceWith(pos, pos + before.nodeSize, next));
    });
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    const texChanged = node.attrs.tex !== this.node.attrs.tex;
    const sourceChanged = node.attrs.source !== this.node.attrs.source;
    this.node = node;
    if (texChanged) this.render();
    if (texChanged || sourceChanged) {
      if (this.state !== "computing") this.setState("current");
      this.scheduleCheck(0);
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.card.contains(event.target);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.renderToken++;
    this.checkToken++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    resultViews.get(this.view)?.delete(this);
    this.card.destroy();
  }
}

/** A node view for `math_result`; `compute` is absent without a runner or read-only, and the result then only shows. */
export function createMathResultView(compute?: MathCompute, loadMath?: MathLoader): NodeViewConstructor {
  const loader = loadMath ?? loadCoreMath;
  return (node, view, getPos) => new MathResultView(node, view, getPos, compute, loader);
}
