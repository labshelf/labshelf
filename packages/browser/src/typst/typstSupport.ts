// Combines the Typst mode with completion, hover and definition from the core language service for one open file.
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import type { ILogger, PaperRecord } from "@labshelf/core";
import { createTypstLanguageService, type TypstSources } from "@labshelf/core/typst/language";
import { definitionBindings, type DefinitionTarget } from "./openDefinition";
import { hoverSource } from "./hoverSource";
import { typstCompletion } from "./typstCompletion";
import { typstLanguage } from "./typstLanguage";

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
