// Declares the editor area's tabs, options, prefs port and mount handle.
import type { IconName } from "../../../ui/icons/index.js";

export type EditorAreaSide = 0 | 1;

export interface EditorTabAction {
  id: string;
  icon: IconName;
  /** Tooltip and accessible name. */
  label: string;
  run(): void;
  /** Goes into the group's "More Actions" menu instead of the toolbar, like VS Code's non-navigation groups. */
  overflow?: boolean;
}

export interface EditorTabBody {
  dispose(): void;
  /** Shown at the end of the tab strip while this tab is its group's active one; read on reveal and on `refreshActions`. */
  actions?: readonly EditorTabAction[];
}

export interface EditorTab {
  id: string;
  title: string;
  icon: IconName;
  group: EditorAreaSide;
  /** Shows the unsaved dot in place of the close button. */
  dirty?: boolean;
  /** Runs once, on the tab's first activation; the body's `dispose` runs when the tab closes. */
  mount(el: HTMLElement): EditorTabBody;
}

export interface EditorTabView {
  id: string;
  title: string;
  group: EditorAreaSide;
  dirty: boolean;
  /** Shown in its group. */
  active: boolean;
  /** The active tab of the group that has focus: the one tab Ctrl/Cmd+W closes. */
  focused: boolean;
}

/** Keeps the first group's width in pixels while two groups show, the way the frame keeps its pane widths. */
export interface EditorAreaPrefsPort {
  load(): number | null;
  save(width: number): void;
}

export interface EditorAreaOptions {
  /** Runs when the focused tab changes. */
  onActivate?(id: string): void;
  /** Runs before a tab closes; false, or a promise of false, keeps it open (a dirty tab whose save was cancelled). */
  onClose?(id: string): boolean | void | Promise<boolean | void>;
  onMove?(id: string, group: EditorAreaSide): void;
  prefs?: EditorAreaPrefsPort;
  /** Kept at the end of the titlebar of the right-most group that shows tabs, after the actions bar. */
  trailing?: HTMLElement;
}

export interface EditorArea {
  /**
   * Adds the tab to `group` (default `tab.group`) and focuses it; an open id updates its title, icon and dirty mark and
   * moves to `group` when given. `background` adds it unfocused (restoring tabs), unless its group shows nothing yet.
   */
  open(tab: EditorTab, group?: EditorAreaSide, how?: { background?: boolean }): void;
  /** Resolves false when the tab is not open or `onClose` kept it. */
  close(id: string): Promise<boolean>;
  activate(id: string): void;
  /** Repaints the toolbar from the body's current `actions` while `id` is its group's active tab, for a body that gets them after mount. */
  refreshActions(id: string): void;
  tabs(): EditorTabView[];
  /** Moves the focused tab to the other group. */
  split(): void;
  /** Disposes every mounted body and removes the area. */
  dispose(): void;
}
