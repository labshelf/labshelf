// Declares what the All projects page shows: a place, a search query and a sort order.
import type { ProjectPlace } from "../projectRow.js";

export type ProjectSortKey = "title" | "cites" | "modified";

export interface ProjectViewState {
  place: ProjectPlace;
  query: string;
  sort: { key: ProjectSortKey; dir: "asc" | "desc" };
}

export const DEFAULT_PROJECT_VIEW: ProjectViewState = { place: "projects", query: "", sort: { key: "modified", dir: "desc" } };

/** Numbers start with the biggest (newest, most cited), titles with A. */
export function firstProjectSortDir(key: ProjectSortKey): "asc" | "desc" {
  return key === "title" ? "asc" : "desc";
}
