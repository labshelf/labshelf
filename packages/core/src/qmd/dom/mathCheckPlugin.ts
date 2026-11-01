// Checks the steps of the math the user edits, in the background (plan math-in-prose D9): 800 ms after the last edit of a math, latest wins.
// Results are cached by (step text, cells above) and kept in plugin state, mapped through transactions; they are never written to the document.
import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { ySyncPluginKey } from "y-prosemirror";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import type { MathResult } from "../compute/cellRunner.js";
import { splitSteps } from "../math/splitSteps.js";
import type { CellsAbove, OnEvalMath } from "./evalMathBridge.js";

const CHECK_DELAY_MS = 800;
const MATH_NODES = ["math_inline", "math_display"];

/** One step `lhs = rhs` of a math, with its tex offsets, and the host's result once it has answered. */
export interface StepCheck { lhs: string; rhs: string; text: string; line: number; from: number; to: number; result?: MathResult }

/** The checks of one math node: its position (kept mapped through transactions), its TeX and its steps. */
interface MathChecks { id: number; pos: number; tex: string; steps: StepCheck[] }

export interface MathCheckState { entries: MathChecks[]; /** Ids of the nodes edited by the last transaction. */ edited: number[] }

interface Reply { id: number; text: string; result: MathResult }

const mathCheckKey = new PluginKey<MathCheckState>("mathCheck");

/**
 * Node decorations carrying each checked math's steps, so its node view redraws its marks when a reply lands (a reply leaves
 * the document unchanged, so only a changed decoration reaches the node view). A math keeps its steps array until it is edited
 * or answered, so a decoration changes only then.
 */
const decorationsByState = new WeakMap<MathCheckState, DecorationSet>();

function stepDecorations(state: EditorState): DecorationSet {
  const value = mathCheckKey.getState(state);
  if (!value) return DecorationSet.empty;
  const known = decorationsByState.get(value);
  if (known) return known;
  const decorations: Decoration[] = [];
  for (const entry of value.entries) {
    const node = state.doc.nodeAt(entry.pos);
    if (!node || !isMath(node) || !entry.steps.some((step) => step.result)) continue;
    decorations.push(Decoration.node(entry.pos, entry.pos + node.nodeSize, {}, { mathSteps: entry.steps }));
  }
  const set = DecorationSet.create(state.doc, decorations);
  decorationsByState.set(value, set);
  return set;
}

/** The step checks a math node view receives in its decorations, or undefined when none of its steps is answered yet. */
export function stepChecksOf(decorations: readonly Decoration[]): readonly StepCheck[] | undefined {
  for (const decoration of decorations) {
    const steps = (decoration.spec as { mathSteps?: readonly StepCheck[] }).mathSteps;
    if (steps) return steps;
  }
  return undefined;
}

/** The step checks of the math node at `pos`, or undefined when it was not checked (or has no step). */
export function mathStepChecks(state: EditorState, pos: number): StepCheck[] | undefined {
  return mathCheckKey.getState(state)?.entries.find((entry) => entry.pos === pos)?.steps;
}

export interface MathCheckOptions {
  onEvalMath: OnEvalMath;
  cellsAbove?: CellsAbove;
  /** True for a transaction that replaces the content from outside (setBody), which is not an edit. */
  isExternal(tr: Transaction): boolean;
}

let nextId = 0;

const isMath = (node: PmNode): boolean => MATH_NODES.includes(node.type.name);

function stepsOf(tex: string): StepCheck[] {
  return splitSteps(tex).map((step) => ({ lhs: step.lhs, rhs: step.rhs, text: `${step.lhs.replace(/\s+/g, " ")} = ${step.rhs.replace(/\s+/g, " ")}`, line: step.line, from: step.from, to: step.to }));
}

function isRemote(tr: Transaction): boolean {
  return Boolean((tr.getMeta(ySyncPluginKey as unknown as PluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin);
}

/** The math nodes of the new document that the transaction touched, as position to node. */
function touchedMath(tr: Transaction): Map<number, PmNode> {
  const found = new Map<number, PmNode>();
  // An attribute step (setNodeAttribute) has an empty step map, so it is read from the step itself.
  tr.steps.forEach((step, index) => {
    const json = step.toJSON() as { stepType?: string; pos?: number };
    if (json.stepType !== "attr" || typeof json.pos !== "number") return;
    const pos = tr.mapping.slice(index + 1).map(json.pos, -1);
    const node = tr.doc.nodeAt(pos);
    if (node && isMath(node)) found.set(pos, node);
  });
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = rest.map(newStart, -1);
      const to = rest.map(newEnd, 1);
      if (from >= to) return;
      tr.doc.nodesBetween(from, Math.min(to, tr.doc.content.size), (node, pos) => {
        if (isMath(node) && pos < to && from < pos + node.nodeSize) found.set(pos, node);
        return !isMath(node);
      });
    });
  });
  return found;
}

function applyTransaction(tr: Transaction, value: MathCheckState, external: boolean): MathCheckState {
  const replies = tr.getMeta(mathCheckKey) as Reply[] | undefined;
  if (!tr.docChanged && !replies) return value.edited.length === 0 ? value : { entries: value.entries, edited: [] };
  let entries = value.entries;
  const edited: number[] = [];
  if (tr.docChanged) {
    const touched = external || isRemote(tr) ? new Map<number, PmNode>() : touchedMath(tr);
    const next: MathChecks[] = [];
    const claimed = new Set<number>();
    for (const entry of entries) {
      const mapped = tr.mapping.mapResult(entry.pos, -1);
      const node = touched.get(mapped.pos);
      if (node && !claimed.has(mapped.pos)) {
        claimed.add(mapped.pos);
        const tex = node.attrs.tex as string;
        if (tex === entry.tex) { next.push({ ...entry, pos: mapped.pos }); continue; }
        next.push({ id: entry.id, pos: mapped.pos, tex, steps: stepsOf(tex) });
        edited.push(entry.id);
      } else {
        const here = mapped.deleted ? null : tr.doc.nodeAt(mapped.pos);
        if (here && isMath(here) && here.attrs.tex === entry.tex) next.push({ ...entry, pos: mapped.pos });
      }
    }
    for (const [pos, node] of touched) {
      if (claimed.has(pos)) continue;
      const tex = node.attrs.tex as string;
      const entry: MathChecks = { id: ++nextId, pos, tex, steps: stepsOf(tex) };
      next.push(entry);
      edited.push(entry.id);
    }
    entries = next;
  }
  if (replies) {
    entries = entries.map((entry) => {
      const mine = replies.filter((reply) => reply.id === entry.id);
      if (mine.length === 0) return entry;
      return { ...entry, steps: entry.steps.map((step) => { const reply = mine.find((r) => r.text === step.text); return reply ? { ...step, result: reply.result } : step; }) };
    });
  }
  return { entries, edited };
}

/** The check plugin: edited math is split into steps and each step checked through `onEvalMath`, results held in plugin state only. */
export function mathCheckPlugin(options: MathCheckOptions): Plugin<MathCheckState> {
  const { onEvalMath, cellsAbove } = options;
  const cache = new Map<string, MathResult>();
  /** Requests sent and not answered, with the nodes waiting on each. */
  const inflight = new Map<string, { id: number; text: string }[]>();
  return new Plugin<MathCheckState>({
    key: mathCheckKey,
    state: {
      init: () => ({ entries: [], edited: [] }),
      apply: (tr, value) => applyTransaction(tr, value, options.isExternal(tr)),
    },
    props: { decorations: stepDecorations },
    view: (initialView) => {
      const timers = new Map<number, Debouncer<[]>>();
      let view: EditorView | null = initialView;
      const deliver = (replies: Reply[]): void => {
        if (view && replies.length > 0) view.dispatch(view.state.tr.setMeta(mathCheckKey, replies).setMeta("addToHistory", false));
      };
      const fire = (id: number): void => {
        timers.delete(id);
        const entry = view && mathCheckKey.getState(view.state)?.entries.find((e) => e.id === id);
        if (!entry) return;
        const source = cellsAbove ? cellsAbove(entry.pos).join("\n") : "";
        const ready: Reply[] = [];
        const asked = new Set<string>();
        for (const step of entry.steps) {
          if (step.result || asked.has(step.text)) continue;
          asked.add(step.text);
          const cacheKey = `${step.text}\u0000${source}`;
          const cached = cache.get(cacheKey);
          if (cached) { ready.push({ id, text: step.text, result: cached }); continue; }
          const waiting = inflight.get(cacheKey);
          if (waiting) { waiting.push({ id, text: step.text }); continue; }
          inflight.set(cacheKey, [{ id, text: step.text }]);
          onEvalMath({ op: "check", tex: step.text }, (result) => {
            cache.set(cacheKey, result);
            const waiters = inflight.get(cacheKey) ?? [];
            inflight.delete(cacheKey);
            deliver(waiters.map((waiter) => ({ ...waiter, result })));
          });
        }
        deliver(ready);
      };
      return {
        update(updated) {
          for (const id of mathCheckKey.getState(updated.state)?.edited ?? []) {
            let timer = timers.get(id);
            if (!timer) { timer = createDebouncer(() => fire(id), CHECK_DELAY_MS); timers.set(id, timer); }
            timer.call();
          }
        },
        destroy() {
          view = null;
          for (const timer of timers.values()) timer.cancel();
          timers.clear();
          inflight.clear();
        },
      };
    },
  });
}
