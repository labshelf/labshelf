// Declares the open project's trees (Files, Outline, Checklist) as the host sends them to the sidebar, and the label a file shows.
import type { IconName } from "../ui/index.js";

export type ProjectTreeView = "files" | "outline" | "checklist";

const PROJECT_TREE_VIEWS: readonly unknown[] = ["files", "outline", "checklist"] satisfies ProjectTreeView[];

export const isProjectTreeView = (view: unknown): view is ProjectTreeView => PROJECT_TREE_VIEWS.includes(view);

export type SidebarNodeIcon =
  | { kind: "glyph"; name: IconName }
  /** A short file-type label in the icon column, like a paper's REF. */
  | { kind: "label"; text: string; tone: FileLabelTone }
  /** A small filled dot whose colour says how the row stands. */
  | { kind: "dot"; tone: DotTone };

/** err: an error; warn: a warning; accent: in progress; ok: done; muted: open or neutral. */
export type DotTone = "err" | "warn" | "accent" | "ok" | "muted";

export type FileLabelTone = "tex" | "typ" | "pdf" | "ref" | "plain";

export interface SidebarTreeNode {
  /** Unique within its view and stable across refreshes, so expansion survives them. */
  key: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: SidebarNodeIcon;
  /** Present for a node that folds; empty when it has no rows yet. */
  children?: SidebarTreeNode[];
  /** Whether a folding node starts open. */
  open?: boolean;
  /** Present for a node with a checkbox. */
  checked?: boolean;
  /** A click runs the node's command instead of folding it. */
  clickable?: boolean;
  menu?: Array<{ label: string; action: string; danger?: boolean }>;
  /** A mark at the row's right edge with its own click, e.g. a paper's status. */
  trailing?: { icon: SidebarNodeIcon; tooltip: string; action: string };
  /** Drawn faded, e.g. the "12 read" subgroup. */
  dim?: boolean;
  /** Text struck through, e.g. a done manual item. */
  struck?: boolean;
  /** A small text button on the row, e.g. "Regenerate". */
  inlineAction?: { action: string; label: string };
  /** A hover "+" opens an inline input under the row; its text goes to the host as an add request. */
  addable?: { placeholder: string };
}

export interface SidebarTreeAction {
  action: string;
  label: string;
  icon: IconName;
}

export interface SidebarProjectTree {
  view: ProjectTreeView;
  title: string;
  actions: SidebarTreeAction[];
  /** An always-visible two-option toggle, the first row of the pane, e.g. By kind | By section. */
  toggle?: { options: Array<{ action: string; label: string }>; selected: string };
  nodes: SidebarTreeNode[];
  /** Shown when `nodes` is empty. */
  empty: string;
}

/** The project open in the window; `id` is the host's key, as in the project list. */
export interface SidebarOpenProject {
  id: string;
  name: string;
  format?: "latex" | "typst";
  trees: SidebarProjectTree[];
}

const FILE_LABELS: Record<string, [string, FileLabelTone]> = {
  tex: ["TEX", "tex"], sty: ["STY", "tex"], cls: ["CLS", "tex"], typ: ["TYP", "typ"],
  pdf: ["PDF", "pdf"], bib: ["BIB", "ref"], md: ["MD", "plain"], json: ["{}", "plain"], yaml: ["YML", "plain"], yml: ["YML", "plain"],
};

/** A file's icon: its type label when it has one, else the plain file glyph. */
export function deriveFileIcon(name: string): SidebarNodeIcon {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const label = FILE_LABELS[ext];
  return label ? { kind: "label", text: label[0], tone: label[1] } : { kind: "glyph", name: "file" };
}
