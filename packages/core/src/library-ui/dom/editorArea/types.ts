// Declares the editor area's tabs, options, prefs port and mount handle.
import type { IconName } from "../../../ui/icons/index.js";

export type EditorGroupIndex = 0 | 1;

export interface EditorTabBody { dispose(): void }

export interface EditorTab {
  id: string;
  title: string;
  icon: IconName;
  group: EditorGroupIndex;
  /** Shows the unsaved dot in place of the close button. */
  dirty?: boolean;
  /** Runs once, on the tab's first activation; the body's `dispose` runs when the tab closes. */
  mount(el: HTMLElement): EditorTabBody;
}

export interface EditorTabInfo {
  id: string;
  title: string;
  group: EditorGroupIndex;
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
  onMove?(id: string, group: EditorGroupIndex): void;
  prefs?: EditorAreaPrefsPort;
}

export interface EditorArea {
  /**
   * Adds the tab to `group` (default `tab.group`) and focuses it; an open id updates its title, icon and dirty mark and
   * moves to `group` when given. `background` adds it unfocused (restoring tabs), unless its group shows nothing yet.
   */
  open(tab: EditorTab, group?: EditorGroupIndex, how?: { background?: boolean }): void;
  /** Resolves false when the tab is not open or `onClose` kept it. */
  close(id: string): Promise<boolean>;
  activate(id: string): void;
  tabs(): EditorTabInfo[];
  /** Moves the focused tab to the other group. */
  split(): void;
  /** Disposes every mounted body and removes the area. */
  dispose(): void;
}
