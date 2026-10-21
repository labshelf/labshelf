// Builds the overview of one Space: timeline, papers in focus and linked projects.
import type { Space } from "../../model/index.js";
import { resolvePaper, type LibraryPapers } from "../resolvePaper.js";
import { buildTimeline } from "./spaceTimeline.js";
import type { SpaceOverview, SpaceProjectInfo } from "../viewTypes.js";

export function buildOverview(space: Space, library: LibraryPapers, projects: readonly SpaceProjectInfo[], today: string): SpaceOverview {
  return {
    timeline: buildTimeline(space, library, projects, today),
    focus: space.papers.filter((p) => p.focus).map((p) => resolvePaper(p.id, library)),
    projects: space.projects.map((id) => projects.find((p) => p.projectId === id) ?? { projectId: id, title: id, available: false }),
  };
}
