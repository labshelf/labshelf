// Answers the reader's requests from a build preview: opens the source behind a double-click, runs its writing actions and names the papers it cites.
import type { PathOps, PreviewPorts } from "@labshelf/core";
import { lookupCitation, openCitedPaper, type PreviewCitationDeps } from "./citations/index.js";
import type { WritingActions } from "./roots/index.js";
import { showSource } from "./sourceLinks/index.js";

export interface PreviewPortsDeps extends PreviewCitationDeps {
  paths: PathOps;
  actions: WritingActions;
}

export function createPreviewPorts(deps: PreviewPortsDeps): PreviewPorts {
  return {
    showSource: (point) => showSource(deps, point),
    lookupCitation: (query) => lookupCitation(deps, query),
    openCitedPaper: (paperId) => openCitedPaper(deps, paperId),
    ...deps.actions,
  };
}
