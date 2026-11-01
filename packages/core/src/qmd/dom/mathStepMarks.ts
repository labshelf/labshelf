// The step marks of a checked math (plan math-in-prose D9, D12): a glyph per answered step, after an inline math or in a gutter
// with a row per aligned line of a display math, a wavy underline when a step differs, and a hover card per mark.
import { renderElement } from "../../ui/dom/index.js";
import type { StepCheck } from "./mathCheckPlugin.js";
import { attachMathHoverCard, type MathHoverCard } from "./mathHoverCard.js";

type StepResult = NonNullable<StepCheck["result"]>;

/**
 * Glyph and spoken word per check state (D4 glyphs as text: check mark, almost equal, ballot x, warning sign, question mark);
 * sampled is drawn weaker than proved so a sample never reads as a proof.
 */
const MARKS: Record<string, { glyph: string; word: string }> = {
  proved: { glyph: String.fromCodePoint(0x2713), word: "proved" },
  sampled: { glyph: String.fromCodePoint(0x2248), word: "sampled, not proved" },
  differs: { glyph: String.fromCodePoint(0x2717), word: "differs" },
  conditional: { glyph: String.fromCodePoint(0x26a0), word: "conditional" },
  unread: { glyph: "?", word: "unread" },
};

function markOf(state: string): { glyph: string; word: string; key: string } {
  const known = MARKS[state];
  return known ? { ...known, key: state } : { glyph: "?", word: state === "failed" ? "check failed" : state, key: "failed" };
}

export interface MathStepMarks {
  /** Draws the marks of `steps` (undefined or no answered step: none). */
  update(steps: readonly StepCheck[] | undefined): void;
  /** Whether `target` is inside the marks or their cards. */
  contains(target: EventTarget | null): boolean;
  destroy(): void;
}

/** The card text of a step: its state, Read as, rewrites, messages, the counterexample and the condition. */
function cardContent(step: StepCheck, result: StepResult, word: string): HTMLElement[] {
  const text = (value: string, extra = ""): HTMLElement => renderElement("span", { class: `qmd-math-card-text${extra}`, text: value });
  const content = [text(`${step.lhs.trim()} = ${step.rhs.trim()}: ${word}`, " qmd-math-card-warning")];
  if (result.readAs) content.push(text(`Read as ${result.readAs}`));
  if (result.rewrites.length > 0) content.push(text(`Rewrites: ${result.rewrites.join(", ")}`));
  if (result.condition) content.push(text(`Holds when ${result.condition}`));
  const counter = result.counterexample;
  if (counter) {
    const point = Object.entries(counter.point).map(([name, value]) => `${name} = ${value}`).join(", ");
    content.push(text(`At ${point}: left ${counter.lhs}, right ${counter.rhs}`));
  }
  for (const message of result.messages) content.push(text(message));
  return content;
}

/**
 * Attaches the step marks to a math node view: `host` is its dom, `rendered` the typeset math that gets the wavy class, and
 * `onCard` runs when a mark's card shows (the node view hides its own card then).
 */
export function attachMathStepMarks(host: HTMLElement, rendered: HTMLElement, display: boolean, onCard: () => void): MathStepMarks {
  const container = renderElement(display ? "div" : "span", { class: display ? "qmd-math-steps qmd-math-steps-gutter" : "qmd-math-steps", contenteditable: "false" });
  let cards: MathHoverCard[] = [];
  const clear = (): void => {
    for (const card of cards) card.destroy();
    cards = [];
    container.replaceChildren();
  };
  const renderMark = (step: StepCheck, result: StepResult): HTMLElement => {
    const { glyph, word, key } = markOf(result.state);
    const mark = renderElement("span", { class: `qmd-math-step is-${key}`, tabindex: "0", "aria-label": `Step ${step.lhs.trim()} = ${step.rhs.trim()}: ${word}` }, renderElement("span", { class: "qmd-math-step-glyph", "aria-hidden": "true", text: glyph }));
    cards.push(attachMathHoverCard(mark, "Step check", () => { onCard(); return cardContent(step, result, word); }));
    return mark;
  };
  return {
    update(steps) {
      clear();
      const answered = (steps ?? []).filter((step): step is StepCheck & { result: StepResult } => step.result !== undefined);
      rendered.classList.toggle("qmd-math-wavy", answered.some((step) => step.result.state === "differs"));
      if (answered.length === 0) { container.remove(); return; }
      if (display) {
        const lines = Math.max(...(steps ?? []).map((step) => step.line)) + 1;
        for (let line = 0; line < lines; line++) {
          container.append(renderElement("div", { class: "qmd-math-steps-line" }, ...answered.filter((step) => step.line === line).map((step) => renderMark(step, step.result))));
        }
      } else {
        container.append(...answered.map((step) => renderMark(step, step.result)));
      }
      if (container.parentNode !== host) host.append(container);
    },
    contains: (target) => target instanceof Node && container.contains(target),
    destroy() {
      clear();
      container.remove();
      rendered.classList.remove("qmd-math-wavy");
    },
  };
}
