// Answers the reader's requests from a build preview: opens the source behind a double-click, runs its writing actions and names the papers it cites.
import type { PreviewPorts } from "@labshelf/core";
import { withCitationFixes, type CitationFixDeps } from "./citationFixes/index.js";
import { lookupCitation, openCitedPaper, type PreviewCitationDeps } from "./citations/index.js";
import type { ProjectActions } from "./projectActions/index.js";
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
  bodyPages: (root: string, contentPages: number) => void;
  actions: WritingActions;
  /** The toolbar's project actions; the reader hides the controls whose action is absent. */
  projectActions?: ProjectActions;
  /** The citation-card fixes, when a library is open; cards carry no fix without it. */
  fixes?: () => CitationFixDeps | undefined;
}

export function createPreviewPorts(deps: PreviewPortsDeps): PreviewPorts {
  return {
    showSource: (point) => showSource(deps, point),
    lookupCitation: async (query) => {
      const entries = await lookupCitation(deps, query);
      const fixes = deps.fixes?.();
      return fixes ? withCitationFixes(fixes, entries) : entries;
    },
    openCitedPaper: (paperId) => openCitedPaper(deps, paperId),
    bodyPages: (root, contentPages) => deps.bodyPages(root, contentPages),
    ...deps.actions,
    ...deps.projectActions,
  };
}
