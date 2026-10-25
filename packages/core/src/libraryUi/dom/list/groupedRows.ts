// Renders item groups as labelled rowgroups, each body kept in step by its own row reconciler.
import { el } from "../../../ui/dom/index.js";
import { RowReconciler } from "./rowReconciler.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { deriveGroupLabel } from "./derivePaperGroups.js";

const SEP_HTML = `<span class="group-sep">${icon("chevron-right")}</span>`;

/** The path of the folder `up` levels above `folder`. */
const ancestor = (folder: string, up: number): string => folder.split("/").slice(0, folder.split("/").length - up).join("/");

/**
 * The label element for the group of `folder`, at `segments` below the scope. Each segment is a button carrying its
 * folder in data-folder; the label is hidden from assistive tech because the rowgroup carries the name, and the
 * sidebar and breadcrumb are the keyboard path to a folder.
 */
function buildGroupLabel(folder: string, segments: readonly string[]): HTMLElement {
  const { shown, title } = deriveGroupLabel(segments);
  const last = segments.length - 1;
  const crumbs = shown.map((i, k) => {
    const gap = k > 0 && i > shown[k - 1]! + 1 ? `<span class="group-gap">…</span>${SEP_HTML}` : "";
    const btn = `<button type="button" tabindex="-1" class="${i === last ? "group-last" : "group-parent"}" ` +
      `data-folder="${escapeHtml(ancestor(folder, last - i))}" title="Open ${escapeHtml(segments[i]!)}">${escapeHtml(segments[i]!)}</button>`;
    return gap + btn;
  });
  return el("div", {
    class: "group-label", "aria-hidden": "true", title,
    html: crumbs.join(SEP_HTML),
  });
}

/** A group with an empty `segments` renders without a label. */
export interface RowGroup {
  key: string;
  segments: string[];
}

export interface GroupAccess<T, G> {
  items: (group: G) => readonly T[];
  /** The rowgroup's accessible name, such as its path and item count. */
  ariaLabel: (group: G) => string;
}

interface GroupShell<T extends { id: string }> {
  node: HTMLElement;
  body: HTMLElement;
  rows: RowReconciler<T>;
  label: HTMLElement | null;
  /** The accessible name the current label was built for. */
  labelSig: string;
}

interface GroupItem<G> {
  id: string;
  group: G;
}

export class GroupedRows<T extends { id: string }, G extends RowGroup> {
  private shells = new Map<string, GroupShell<T>>();
  private readonly groups: RowReconciler<GroupItem<G>>;

  constructor(container: HTMLElement, private readonly makeRows: (body: HTMLElement) => RowReconciler<T>, private readonly access: GroupAccess<T, G>) {
    // The shell is rebuilt only when a group switches between the unlabelled top group and a labelled subfolder.
    this.groups = new RowReconciler<GroupItem<G>>(container, (item) => this.buildShell(item), (item) => [item.group.segments.length === 0]);
  }

  /** Renders `groups` in order, followed by `trailing` (an empty state) when given. */
  update(groups: readonly G[], trailing: HTMLElement | null): void {
    this.groups.update(groups.map((group) => ({ id: group.key, group })), trailing);
    const alive = new Set(groups.map((g) => g.key));
    for (const key of [...this.shells.keys()]) if (!alive.has(key)) this.shells.delete(key);
    for (const g of groups) this.paintShell(this.shells.get(g.key)!, g);
  }

  private buildShell({ group }: GroupItem<G>): HTMLElement {
    const body = el("div", { class: "group-body", role: "none" });
    const node = el("div", { class: "paper-group", role: "rowgroup" }, body);
    this.shells.set(group.key, { node, body, rows: this.makeRows(body), label: null, labelSig: "" });
    return node;
  }

  private paintShell(shell: GroupShell<T>, group: G): void {
    shell.rows.update(this.access.items(group));
    if (group.segments.length === 0) return;
    const aria = this.access.ariaLabel(group);
    if (shell.labelSig === aria) return;
    shell.node.setAttribute("aria-label", aria);
    const label = buildGroupLabel(group.key, group.segments);
    if (shell.label) shell.label.replaceWith(label);
    else shell.node.insertBefore(label, shell.body);
    shell.label = label;
    shell.labelSig = aria;
  }
}
