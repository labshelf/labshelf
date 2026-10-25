// Lists the preprints of a project's .bib files that have a published version, as findings the preview places on the PDF.
import { checkBibliography, type ILogger, type PublishedVersionFinder } from "@labshelf/core";
import type { ReadyProject } from "../../buildRootDocument.js";
import { userBibFiles } from "../citations/index.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";

export interface ProjectPreprintsDeps {
  /** The library root, and with it the logger, can change after activation. */
  logger: () => ILogger | undefined;
  lookup: PublishedVersionFinder;
}

type Preprint = { key: string; message: string; file?: string; line?: number };

const lineAt = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

export function projectPreprints(deps: ProjectPreprintsDeps): (project: ReadyProject) => Promise<Preprint[]> {
  return async (project) => {
    try {
      const preprints: Preprint[] = [];
      for (const document of await userBibFiles(project.folder)) {
        const text = document.getText();
        for (const finding of await checkBibliography(text, deps.lookup)) {
          if (finding.rule !== "published-version") { continue; }
          preprints.push({ key: finding.key, message: finding.message, file: document.uri.fsPath, line: lineAt(text, finding.start) });
        }
      }
      return preprints;
    } catch (error) {
      await deps.logger()?.error(PREVIEW_LOG_MODULE, error, { projectFolder: project.folder, action: "preprints" });
      return [];
    }
  };
}
