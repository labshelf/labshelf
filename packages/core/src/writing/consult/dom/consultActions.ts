// What a consult window can do with what it shows when its surface writes (the source editor): cite a paper's scope and list code at the editor's
// cursor, and link an output. The reader passes none, and its windows offer Copy only. Also the bubble that offers these actions over a selection.
import type { CitationScope } from "../../citations/citationScopes.js";
import { renderElement } from "../../../ui/dom/dom.js";
import { renderPillBar, type PillGroup } from "../../../ui/dom/widgets/pillBar.js";
import type { ConsultRef } from "../consultRequests.js";

export interface ConsultActions {
  /** Writes the citation of the paper's scope at the editor's cursor, saves its scope and brings the paper into the bibliography. */
  cite(paperId: string, scope: CitationScope, quoted: boolean): Promise<void>;
  /** The exact text `cite` would write. */
  citationText(paperId: string, scope: CitationScope, quoted: boolean): Promise<string>;
  /**
   * Writes a linked listing of the 0-based lines `startLine`..`endLine` of a consulted code file, whose current text is `text`; absent when the
   * editor lists no code.
   */
  insertListing?(ref: ConsultRef, text: string, startLine: number, endLine: number): Promise<void>;
  /** True when `insertListing` can link this file from the editor's project (a file picked outside the library cannot be linked in the browser). */
  canList?(ref: ConsultRef): boolean;
  /** Opens Link output; absent when the editor has no project to link outputs to. */
  linkOutput?(): void;
}

/** A scope with text: Cite with quote puts its words before the citation. */
export const isQuotable = (scope: CitationScope): boolean => scope.kind === "highlight" || scope.kind === "passage" || scope.kind === "note";

/** The pill shown over a selection in a consult window: one at a time, hidden on Escape, on a press outside it, or after an action. */
export interface ActionBubble {
  show(groups: readonly PillGroup[], at: { left: number; top: number; bottom: number }): void;
  hide(): void;
  readonly shown: boolean;
  destroy(): void;
}

const GAP_PX = 8;

export function createActionBubble(label: string): ActionBubble {
  const pill = renderElement("div", { class: "ls-consult-bubble", role: "toolbar", hidden: "" });
  let attached = false;
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !pill.hidden) { event.stopPropagation(); hide(); }
  };
  const onPress = (event: PointerEvent): void => {
    if (!pill.hidden && !(event.target instanceof Node && pill.contains(event.target))) hide();
  };
  const hide = (): void => {
    pill.hidden = true;
  };
  return {
    show(groups, at) {
      if (!attached) {
        document.body.append(pill);
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", onPress, true);
        attached = true;
      }
      // An action runs, then the bubble goes: the press itself does not take the selection.
      const wrapped = groups.map((group) => group.map((item) => (item instanceof HTMLElement ? item : { ...item, run: (button: HTMLButtonElement) => { hide(); item.run(button); } })));
      renderPillBar(wrapped, { label, pill });
      pill.hidden = false;
      const width = pill.offsetWidth;
      const height = pill.offsetHeight;
      const left = Math.min(Math.max(GAP_PX, at.left - width / 2), window.innerWidth - width - GAP_PX);
      const above = at.top - height - GAP_PX;
      pill.style.left = `${left}px`;
      pill.style.top = `${above >= GAP_PX ? above : at.bottom + GAP_PX}px`;
    },
    hide,
    get shown() { return !pill.hidden; },
    destroy() {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPress, true);
      pill.remove();
    },
  };
}

/** A fixed row of text buttons at the top of a window's body, for what does not live on a selection (Cite paper, Insert whole file). */
export function renderActionBar(): HTMLElement {
  return renderElement("div", { class: "ls-consult-actions", role: "toolbar", "aria-label": "Window actions" });
}
