// Combines the Typst mode with Tinymist completion, hover, definition and diagnostics for one open file.
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import type { ILogger, PaperRecord } from "@labshelf/core";
import type { HelperLspChannel } from "../../helperProject";
import { definitionBindings, type DefinitionTarget } from "./goToDefinition";
import { hoverSource } from "./hoverSource";
import { openTypstDocument, type LspDiagnostic } from "./lsp";
import { typstCompletion } from "./typstCompletion";
import { typstLanguage } from "./typstLanguage";

export interface TypstSupportDeps extends DefinitionTarget {
  path: string;
  channel: HelperLspChannel;
  logger: ILogger;
  papers(): Promise<readonly PaperRecord[]>;
  /** The editor's text now, which the server opens the document with. */
  text(): string;
  onDiagnostics(diagnostics: readonly LspDiagnostic[]): void;
}

export interface TypstSupport {
  extension: Extension;
  /** Closes the language-server document. */
  close(): void;
}

export function typstSupport(deps: TypstSupportDeps): TypstSupport {
  const doc = openTypstDocument({ projectId: deps.projectId, path: deps.path, channel: deps.channel, logger: deps.logger, text: deps.text, onDiagnostics: deps.onDiagnostics });
  return {
    close: doc.close,
    extension: [
      typstLanguage,
      autocompletion({ override: [typstCompletion(doc, deps.papers)] }),
      hoverTooltip(hoverSource(doc)),
      definitionBindings(doc, deps),
    ],
  };
}
