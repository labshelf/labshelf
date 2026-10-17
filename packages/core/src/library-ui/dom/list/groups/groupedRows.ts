// Renders paper groups as labelled rowgroups, each body kept in step by its own row reconciler.
import { el } from "../../../../ui/dom/index.js";
import type { ListPaper } from "../../../derive/index.js";
import { RowReconciler } from "../rowReconciler.js";
import { buildGroupLabel } from "./groupLabelView.js";
import { groupAriaLabel, type PaperGroup } from "./groupPapers.js";

interface GroupShell {
  node: HTMLElement;
  body: HTMLElement;
  rows: RowReconciler<ListPaper>;
  label: HTMLElement | null;
  /** The accessible name (path and count) the current label was built for. */
  labelSig: string;
}

interface GroupItem {
  id: string;
  group: PaperGroup;
}

export class GroupedRows {
  private shells = new Map<string, GroupShell>();
  private readonly groups: RowReconciler<GroupItem>;

  constructor(container: HTMLElement, private readonly makeRows: (body: HTMLElement) => RowReconciler<ListPaper>) {
    // The shell is rebuilt only when a group switches between the unlabelled own group and a labelled subfolder.
    this.groups = new RowReconciler<GroupItem>(container, (item) => this.buildShell(item), (item) => [item.group.segments.length === 0]);
  }

  /** Renders `groups` in order, followed by `trailing` (an empty state) when given. */
  update(groups: readonly PaperGroup[], trailing: HTMLElement | null): void {
    this.groups.update(groups.map((group) => ({ id: group.key, group })), trailing);
    const alive = new Set(groups.map((g) => g.key));
    for (const key of [...this.shells.keys()]) if (!alive.has(key)) this.shells.delete(key);
    for (const g of groups) this.paintShell(this.shells.get(g.key)!, g);
  }

  private buildShell({ group }: GroupItem): HTMLElement {
    const body = el("div", { class: "group-body", role: "none" });
    const node = el("div", { class: "paper-group", role: "rowgroup" }, body);
    this.shells.set(group.key, { node, body, rows: this.makeRows(body), label: null, labelSig: "" });
    return node;
  }

  private paintShell(shell: GroupShell, group: PaperGroup): void {
    shell.rows.update(group.papers);
    if (group.segments.length === 0) return;
    const aria = groupAriaLabel(group.segments, group.papers.length);
    if (shell.labelSig === aria) return;
    shell.node.setAttribute("aria-label", aria);
    const label = buildGroupLabel(group.key, group.segments);
    if (shell.label) shell.label.replaceWith(label);
    else shell.node.insertBefore(label, shell.body);
    shell.label = label;
    shell.labelSig = aria;
  }
}
