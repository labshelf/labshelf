// Creates the Typst language service: completion, hover and definition over the edited text and the project's files.
import type { ILogger } from "../../../ports/index.js";
import { projectFiles } from "./project/index.js";
import { typstCompletions } from "./typstCompletion.js";
import { typstDefinition } from "./typstDefinition.js";
import { typstHover } from "./typstHover.js";
import type { TypstLanguageService, TypstSources } from "./typstLanguageTypes.js";

export function createTypstLanguageService(options: { sources: TypstSources; logger: ILogger }): TypstLanguageService {
  const { sources, logger } = options;
  return {
    complete: (path, text, offset, explicit) => typstCompletions(projectFiles(sources, logger, path, text, "complete"), offset, explicit),
    hover: (path, text, offset) => typstHover(projectFiles(sources, logger, path, text, "hover"), offset),
    definition: (path, text, offset) => typstDefinition(projectFiles(sources, logger, path, text, "definition"), offset),
  };
}
