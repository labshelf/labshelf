// Declares the view models Spaces screens show, derived from a Space, the Library and the projects.
import type { ReadingStatus } from "../../library/readingStatus/index.js";
import type { SpaceDateKind } from "../model/index.js";

/** A writing project as the host reports it; supplied by the host port. */
export interface SpaceProjectInfo {
  readonly projectId: string;
  readonly title: string;
  readonly format?: string;
  readonly mainFile?: string;
  /** YYYY-MM-DD */
  readonly deadline?: string;
  readonly checklist?: { readonly done: number; readonly total: number };
  readonly available: boolean;
}

export interface Progress { readonly done: number; readonly total: number }

export type ResolvedPaper =
  | {
    readonly id: string;
    readonly missing: false;
    readonly title: string;
    readonly authors: readonly string[];
    readonly year?: number;
    readonly status: ReadingStatus;
  }
  | { readonly id: string; readonly missing: true };

export interface TimelineEntry {
  readonly id: string;
  readonly kind: SpaceDateKind;
  readonly title: string;
  readonly date: string;
  readonly when: "past" | "today" | "future";
  /** Calendar days from today; negative in the past. */
  readonly daysAway: number;
  /** Past, a task, not done. */
  readonly overdue: boolean;
  readonly done?: boolean;
  readonly progress?: Progress;
  /** Set on deadlines taken from a linked project. */
  readonly fromProject?: true;
}

export interface SpaceOverview {
  readonly timeline: readonly TimelineEntry[];
  readonly focus: readonly ResolvedPaper[];
  readonly projects: readonly SpaceProjectInfo[];
}

export interface PapersTreeFolder {
  readonly id: string;
  readonly name: string;
  readonly folders: readonly PapersTreeFolder[];
  readonly papers: readonly ResolvedPaper[];
}

export interface PapersTree {
  readonly folders: readonly PapersTreeFolder[];
  readonly papers: readonly ResolvedPaper[];
}

export interface CatalogRow {
  readonly id: string;
  readonly name: string;
  readonly purpose?: string;
  readonly reading: Progress;
  readonly next: { readonly date: string; readonly title: string } | null;
  readonly counts: { readonly papers: number; readonly projects: number };
  readonly shared: false;
  /** The reason the Space cannot be read. */
  readonly unreadable?: string;
}

export type SidebarRow =
  | { readonly id: string; readonly name: string; readonly tree: PapersTree }
  | { readonly id: string; readonly name: string; readonly unreadable: string };
