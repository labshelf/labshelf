// Answers the reader's requests from a build preview: opens the source behind a double-click, runs its writing actions and names the papers it cites.
import type { PathOps, PreviewPorts } from "@labshelf/core";
import { lookupCitation, openCitedPaper, type PreviewCitationDeps } from "./citations/index.js";
import type { WritingActions } from "./roots/index.js";
import { showSource } from "./sourceLinks/index.js";

/** The body pages the reader counted in a project's preview. */
export interface BodyPagesCount {
  /** The project folder of the preview panel. */
  folder: string;
  /** The root exactly as the reader reported it: relative to the project folder, `/`-separated. */
  root: string;
  contentPages: number;
}

export interface PreviewPortsDeps extends PreviewCitationDeps {
  paths: PathOps;
  bodyPages: (root: string, contentPages: number) => void;
  actions: WritingActions;
}

export function createPreviewPorts(deps: PreviewPortsDeps): PreviewPorts {
  return {
    showSource: (point) => showSource(deps, point),
    lookupCitation: (query) => lookupCitation(deps, query),
    openCitedPaper: (paperId) => openCitedPaper(deps, paperId),
    bodyPages: (root, contentPages) => deps.bodyPages(root, contentPages),
    ...deps.actions,
  };
}
