// Shows the language service's hover text for the word under the pointer as a tooltip.
import type { EditorView, Tooltip } from "@codemirror/view";
import type { TypstLanguageService } from "@labshelf/core/typst/language";

const FENCE = /^```.*$/gm;

/** For `hoverTooltip`: the tooltip is plain text, since the service answers in markdown. */
export function hoverSource(service: TypstLanguageService, path: string): (view: EditorView, pos: number, side: -1 | 1) => Promise<Tooltip | null> {
  return async (view, pos) => {
    const hover = await service.hover(path, view.state.doc.toString(), pos);
    const text = hover?.text.replace(FENCE, "").trim() ?? "";
    if (!hover || text === "") return null;
    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-typst-hover";
        dom.textContent = text;
        return { dom };
      },
    };
  };
}
