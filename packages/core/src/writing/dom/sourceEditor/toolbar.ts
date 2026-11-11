// Draws the source editor's in-editor toolbar: groups of icon buttons and dropdowns that act on the editor without taking its focus.
import { attachHoverCard, headButton, renderElement, showMenu, type IconName, type MenuEntry } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/icons/index.js";
import type { TypingHelpers } from "../../typing/index.js";
import type { SelectionPopupPrefs } from "../../selectionPopup/index.js";

export interface SourceToolbarButton {
  label: string;
  glyph: IconName;
  run(): void;
  /** Drawn as an outlined pill with its label at the toolbar's right end, for the one primary action such as Share. */
  primary?: boolean;
  /** What pressing it does, in the hover card under the name; defaults to the toolbar's own sentence for a known label. */
  description?: string;
}

interface SourceToolbarOption { value: string; label: string; hint?: string; glyph?: IconName }

/** A button that shows the current option and opens a menu of radio items to pick another. */
export interface SourceToolbarDropdown {
  label: string;
  /** The button's icon; an option's own glyph replaces it while that option is current, and then the button shows no caption. */
  glyph: IconName;
  options: readonly SourceToolbarOption[];
  current(): string;
  pick(value: string): void;
  description?: string;
}

/** A button that opens a menu built when pressed, so its entries follow the text (the slides, the slide at the cursor). */
export interface SourceToolbarMenu {
  label: string;
  glyph: IconName;
  /** A short word shown beside the icon, such as "Slide" on Insert slide. */
  caption?: string;
  menu(): MenuEntry[];
  description?: string;
}

export type SourceToolbarItem = SourceToolbarButton | SourceToolbarDropdown | SourceToolbarMenu;

/** The hover card's sentence for the controls both apps draw, by lower-cased label, so VS Code and the browser say the same. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  "undo": "Undo your last edit. In a shared project, only your own edits are undone.",
  "redo": "Redo the edit you last undid.",
  "bold": "Make the selection bold, or start bold text at the cursor.",
  "italic": "Make the selection italic, or start italic text at the cursor.",
  "insert symbol": "Pick a math symbol or operator and insert its command.",
  "insert table": "Build a table from its size, its cells or a CSV file and insert it at the cursor.",
  "insert image": "Choose an image file and insert it as a figure.",
  "insert figure": "Draw a diagram, written as TikZ, or edit the one at the cursor.",
  "cite from library": "Cite a paper from your LabShelf library at the cursor.",
  "insert code": "Insert a code file, or one definition from it, as a listing that stays linked to the file.",
  "search in project": "Find, and replace, text across every file of the project.",
  "indent document": "Re-indent the whole file to follow its structure.",
  "show project history": "Browse earlier versions of the project, mark one or compare two.",
  "show pdf preview": "Open the compiled PDF beside the source.",
  "hide pdf preview": "Close the PDF preview.",
  "review mode": "Editing changes the text directly; Reviewing keeps your edits as suggestions the others accept or reject.",
  "project chat": "Talk with the people the project is shared with.",
  "share": "Invite people to the project and manage who has access.",
  "present": "Present the talk: the slides full screen, the speaker notes beside them.",
};

/** The card of a toolbar control: its name and what it does, the item's own description first. */
function hoverCard(button: HTMLElement, item: () => { label: string; description?: string }, name: () => string = () => item().label): void {
  attachHoverCard(button, () => {
    const { label, description } = item();
    const sentence = description ?? DESCRIPTIONS[label.toLowerCase()];
    return { label: name(), ...(sentence ? { description: sentence } : {}) };
  });
}

function renderMenuButton(item: SourceToolbarMenu): HTMLElement {
  const button = renderElement("button", { type: "button", class: "source-editor-toolbar-dropdown", title: item.label, "aria-label": item.label, "aria-haspopup": "menu", html: renderIcon(item.glyph) });
  if (item.caption) button.append(renderElement("span", { class: "source-editor-toolbar-dropdown-label", text: item.caption }));
  button.insertAdjacentHTML("beforeend", renderIcon("chevron-down"));
  button.addEventListener("click", () => showMenu(button, item.menu()));
  hoverCard(button, () => item);
  return button;
}

function renderDropdown(item: SourceToolbarDropdown): HTMLElement {
  const button = renderElement("button", { type: "button", class: "source-editor-toolbar-dropdown", title: item.label, "aria-label": item.label, "aria-haspopup": "menu" });
  const refresh = (): void => {
    const option = item.options.find((o) => o.value === item.current());
    // An option with its own icon shows as that icon alone, the label moving to the tooltip.
    if (option?.glyph) {
      button.innerHTML = renderIcon(option.glyph) + renderIcon("chevron-down");
      return;
    }
    button.innerHTML = renderIcon(item.glyph);
    button.append(renderElement("span", { class: "source-editor-toolbar-dropdown-label", text: option?.label ?? "" }));
    button.insertAdjacentHTML("beforeend", renderIcon("chevron-down"));
  };
  refresh();
  button.addEventListener("click", () => {
    const current = item.current();
    showMenu(button, item.options.map((option) => ({
      label: option.label,
      ...(option.hint === undefined ? {} : { hint: option.hint }),
      ...(option.glyph === undefined ? {} : { icon: option.glyph }),
      radio: true,
      checked: option.value === current,
      onSelect: () => { item.pick(option.value); refresh(); },
    })));
  });
  // The card names the current option, which an icon-only button does not show.
  hoverCard(button, () => item, () => {
    const option = item.options.find((o) => o.value === item.current());
    return option ? `${item.label}: ${option.label}` : item.label;
  });
  return button;
}

function renderPrimary(item: SourceToolbarButton): HTMLElement {
  const button = renderElement("button", { type: "button", class: "source-editor-toolbar-primary", title: item.label, html: renderIcon(item.glyph) });
  button.append(renderElement("span", { text: item.label }));
  button.addEventListener("click", () => item.run());
  hoverCard(button, () => item);
  return button;
}

/** A plain icon button; the card reads the item each time, so a label that follows a state (the PDF toggle) stays current. */
function renderIconButton(item: SourceToolbarButton): HTMLElement {
  const button = headButton("ls-icon-btn", item.label, item.glyph, item.run);
  hoverCard(button, () => item);
  return button;
}

type ToolbarGroups = readonly (readonly SourceToolbarItem[])[];

/** What the ⋯ menu's own entries act on: the editor's spelling switch, its typing helpers and its Keyboard Shortcuts dialog. */
interface MoreEntriesEditor {
  spelling: { enabled(): boolean; set(on: boolean): void } | undefined;
  showShortcuts(): void;
  typing?: { set(next: TypingHelpers): void };
  showTypingHelpers?(onChange: (next: TypingHelpers) => void): void;
  showSelectionPopupSettings?(onChange: (next: SelectionPopupPrefs) => void): void;
}

/**
 * The ⋯ menu's own entries both apps give: turning the spell check on or off, which `saveSpelling` stores, Customize Shortcuts…
 * when `saveTyping` stores the typing helpers, Customize Selection Popup… when `saveSelectionPopup` stores its settings, then the
 * Keyboard Shortcuts; none before the editor has mounted.
 */
export function renderSourceMoreEntries(
  editor: MoreEntriesEditor | undefined, saveSpelling: (on: boolean) => void, saveTyping?: (next: TypingHelpers) => void, saveSelectionPopup?: (next: SelectionPopupPrefs) => void,
): MenuEntry[] {
  if (!editor) return [];
  const { spelling, typing, showTypingHelpers } = editor;
  const customize: MenuEntry[] = saveTyping && typing && showTypingHelpers ? [{ label: "Customize Shortcuts…", icon: "keyboard", onSelect: () => showTypingHelpers((next) => {
    typing.set(next);
    saveTyping(next);
  }) }] : [];
  const showPopupSettings = editor.showSelectionPopupSettings;
  const popup: MenuEntry[] = saveSelectionPopup && showPopupSettings ? [{ label: "Customize Selection Popup…", icon: "gear", onSelect: () => showPopupSettings(saveSelectionPopup) }] : [];
  return [
    // Says what a press does, not a checkbox: "Turn spell check off" while the spelling and style checks run.
    ...(spelling ? [{ label: spelling.enabled() ? "Turn spell check off" : "Turn spell check on", icon: "check" as const, onSelect: () => {
      const on = !spelling.enabled();
      spelling.set(on);
      saveSpelling(on);
    } }] : []),
    ...customize,
    ...popup,
    { label: "Keyboard Shortcuts", icon: "keyboard", onSelect: () => editor.showShortcuts() },
  ];
}

/** The toolbar's right end beyond the project's tools. */
export interface SourceToolbarEnd {
  /** Set off at the far right, after Share: the PDF toggle. */
  edge?: readonly SourceToolbarItem[];
  /** The ⋯ menu's own entries, after the buttons the bar hid for lack of room. */
  more?: () => MenuEntry[];
}

function renderGroup(group: readonly SourceToolbarItem[]): HTMLElement {
  const section = renderElement("div", { class: "source-editor-toolbar-group" });
  for (const item of group) {
    section.append("options" in item ? renderDropdown(item) : "menu" in item ? renderMenuButton(item) : item.primary ? renderPrimary(item) : renderIconButton(item));
  }
  return section;
}

/** A group the ⋯ menu can take over: plain buttons only, as a menu item cannot hold a dropdown, a menu or Share. */
function isCollapsible(group: readonly SourceToolbarItem[]): group is readonly SourceToolbarButton[] {
  return group.length > 0 && group.every((item) => !("options" in item) && !("menu" in item) && !item.primary);
}

interface CollapsibleGroup { element: HTMLElement; items: readonly SourceToolbarButton[]; order: number }

/** The ⋯ button: the hidden groups' buttons in their bar order, then the host's own entries. */
function renderMoreButton(hidden: () => readonly CollapsibleGroup[], more: (() => MenuEntry[]) | undefined): HTMLElement {
  const button = renderElement("button", { type: "button", class: "ls-icon-btn source-editor-toolbar-more", title: "More actions", "aria-label": "More actions", "aria-haspopup": "menu", html: renderIcon("more") });
  button.addEventListener("click", () => {
    const entries: MenuEntry[] = [];
    for (const group of [...hidden()].sort((a, b) => a.order - b.order)) {
      if (entries.length > 0) entries.push("separator");
      entries.push(...group.items.map((item) => ({ label: item.label, icon: item.glyph, onSelect: () => item.run() })));
    }
    const own = more?.() ?? [];
    if (entries.length > 0 && own.length > 0) entries.push("separator");
    showMenu(button, [...entries, ...own]);
  });
  attachHoverCard(button, () => ({ label: "More actions", description: "Spell check, keyboard shortcuts and the tools that do not fit in the bar." }));
  return button;
}

/**
 * Hides groups into the ⋯ menu while the bar is too narrow: the project's tools first, then the left groups from the right end,
 * so the inserts, Share and the PDF toggle stay longest. Runs whenever the bar's width changes.
 */
function fitToWidth(bar: HTMLElement, collapsible: readonly CollapsibleGroup[], hidden: CollapsibleGroup[]): void {
  const fit = (): void => {
    if (!bar.isConnected) return;
    hidden.length = 0;
    for (const group of collapsible) group.element.hidden = false;
    for (const group of collapsible) {
      if (bar.scrollWidth <= bar.clientWidth) break;
      group.element.hidden = true;
      hidden.push(group);
    }
  };
  // PLATFORM: ResizeObserver fires once the detached bar is laid out, and again on every width change of the pane; a page
  // without it (a test DOM) keeps every group shown.
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => { if (bar.isConnected) fit(); else observer.disconnect(); });
  observer.observe(bar);
}

/**
 * The toolbar: `groups` at the left, the actions on the text itself, and `right` at the right end, the project's tools and then
 * the collaboration; `end.edge` after them and the ⋯ menu last. Each group is set off from the next; the plain button groups move
 * into the ⋯ menu while the bar is too narrow. A press keeps the editor's focus and selection, which the actions act on.
 */
export function renderSourceToolbar(groups: ToolbarGroups, right: ToolbarGroups = [], end: SourceToolbarEnd = {}): HTMLElement {
  const bar = renderElement("div", { class: "source-editor-toolbar", role: "toolbar", "aria-label": "Editor actions" });
  const left = groups.map(renderGroup);
  const rightElements = right.map(renderGroup);
  bar.append(...left);
  if (right.length > 0 || end.edge) bar.append(renderElement("div", { class: "source-editor-toolbar-spacer" }), ...rightElements);
  if (end.edge && end.edge.length > 0) bar.append(renderGroup(end.edge));
  const collapsible: CollapsibleGroup[] = [
    ...right.flatMap((group, i) => (isCollapsible(group) ? [{ element: rightElements[i]!, items: group, order: groups.length + i }] : [])),
    ...groups.flatMap((group, i) => (isCollapsible(group) ? [{ element: left[i]!, items: group, order: i }] : [])).reverse(),
  ];
  const hidden: CollapsibleGroup[] = [];
  if (collapsible.length > 0 || end.more) {
    bar.append(renderMoreButton(() => hidden, end.more));
    fitToWidth(bar, collapsible, hidden);
  }
  bar.addEventListener("mousedown", (event) => event.preventDefault());
  return bar;
}
