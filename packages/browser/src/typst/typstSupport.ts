// Combines the Typst mode with completion, hover and definition from the core language service for one open file.
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import type { ILogger, PaperRecord } from "@labshelf/core";
import {
  createTypstLanguageService,
  type TypstSources,
  type TypstLanguageService,
} from "@labshelf/core/typst/language";
import { definitionBindings, type DefinitionTarget } from "./openDefinition";
import { typstCompletion } from "./typstCompletion";
import { typstLanguage } from "./typstLanguage";

const FENCE = /^```.*$/gm;

/** For `hoverTooltip`: the tooltip is plain text, since the service answers in markdown. */
function hoverSource(service: TypstLanguageService, path: string): (view: EditorView, pos: number, side: -1 | 1) => Promise<Tooltip | null> {
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

export interface TypstSupportDeps extends DefinitionTarget {
  path: string;
  files: TypstSources;
  logger: ILogger;
  papers(): Promise<readonly PaperRecord[]>;
}

/** The service reads the editor's text on every call, so unsaved edits count. */
export function typstSupport(deps: TypstSupportDeps): Extension {
  const service = createTypstLanguageService({ sources: deps.files, logger: deps.logger });
  return [
    typstLanguage,
    autocompletion({ override: [typstCompletion(service, deps.path, deps.papers)] }),
    hoverTooltip(hoverSource(service, deps.path)),
    definitionBindings(service, deps.path, deps),
  ];
}
