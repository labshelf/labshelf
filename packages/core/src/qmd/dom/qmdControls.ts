// Builds the visible controls of the rich Markdown editor in place of a toolbar: the Insert panel and the block choices (the bubble is qmdBubble.ts).
import { TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { type MenuItem, type SectionPanel, type SectionPanelItem, type SectionPanelSection } from "../../ui/dom/index.js";
import type { IconName } from "../../ui/icons/index.js";
import { CELL_LANGUAGES, cellLanguageLabel, type CellLanguage } from "../compute/index.js";
import { qmdSchema } from "../editor/index.js";
import { insertCodeCell, QMD_ACTIONS, QMD_HEADINGS, shortcutLabel, type QmdAction } from "./qmdCommands.js";

const LIST_ACTIONS = ["bullet", "ordered", "task"] as const;
const LIST_LABELS: Record<(typeof LIST_ACTIONS)[number], string> = { bullet: "Bullets", ordered: "Numbered", task: "Tasks" };
const INLINE_ACTIONS = ["inlineMath", "link"] as const;
/** Opens From paper… at the caret, in an editor that offers it. */
export const FROM_PAPER_KEY = "Mod-Alt-p";

const runCommand = (view: EditorView, command: Command): boolean => command(view.state, view.dispatch.bind(view), view);

/** Runs `action` and gives the editor its focus back; the link command opens an input box that hands focus back itself. */
export function runAction(view: EditorView, action: Pick<QmdAction, "command">): void {
  runCommand(view, action.command);
  if (action.command !== QMD_ACTIONS.link.command) view.focus();
}

/** Where an Insert panel inserts: `language` is the note's cell language, listed first; `place` puts the selection on the block before a gap
 * (each choice then adds its block after it), and without it the choices act at the caret; `source` adds Edit Markdown source; `fromPaper` adds
 * From paper…, which opens the picker of a paper's equations, figures and tables. */
export interface InsertTarget { language: CellLanguage; place?: () => void; source?: () => void; fromPaper?: () => void }

/**
 * The Insert panel, grouped like the project panel: headings, lists and the code cells as chips (a new line is already text, so text is no choice), then the equation and diagram blocks with their
 * shortcuts; at the caret also the inline marks and the Markdown source. At the caret a choice that cannot apply there is disabled.
 */
export function insertPanel(view: EditorView, { language, place, source, fromPaper }: InsertTarget): SectionPanel {
  const atGap = place !== undefined;
  const choose = (insert: () => void) => () => { if (view.isDestroyed) return; place?.(); insert(); view.focus(); };
  // At a gap a text style goes on a new paragraph after the block; at the caret it restyles the block the caret is in.
  const styled = (command: Command) => choose(() => { if (atGap) insertText(view); runCommand(view, command); });
  const disabled = (command: Command): { disabled?: true } => (!atGap && !command(view.state) ? { disabled: true } : {});
  const item = (label: string, icon: IconName | undefined, command: Command, run: () => void, shortcut?: string): SectionPanelItem => ({
    label, ...(icon ? { icon } : {}), ...(shortcut ? { hint: shortcutLabel(shortcut) } : {}), ...disabled(command), run,
  });
  const action = (id: keyof typeof QMD_ACTIONS, label = QMD_ACTIONS[id].label): SectionPanelItem =>
    item(label, QMD_ACTIONS[id].icon, QMD_ACTIONS[id].command, choose(() => runCommand(view, QMD_ACTIONS[id].command)), QMD_ACTIONS[id].shortcut);
  const headings = QMD_HEADINGS.filter((heading) => heading.level > 0);
  const languages = [language, ...CELL_LANGUAGES.filter((other) => other !== language)];
  const sections: SectionPanelSection[] = [
    { title: "Heading", layout: "chips", items: headings.map((heading) => item(heading.label, undefined, heading.command, styled(heading.command))) },
    { title: "List", layout: "chips", items: LIST_ACTIONS.map((id) => item(LIST_LABELS[id], QMD_ACTIONS[id].icon, QMD_ACTIONS[id].command, styled(QMD_ACTIONS[id].command))) },
    { title: "Code cell", layout: "chips", items: languages.map((lang) => {
      const command = insertCodeCell(lang);
      return item(cellLanguageLabel(lang), "code", command, choose(() => runCommand(view, command)));
    }) },
    { title: "Math and figures", items: [action("displayMath", "Equation"), action("figure"), action("table"), ...(fromPaper ? [fromPaperItem(view, place, fromPaper)] : [])] },
  ];
  if (!atGap) sections.push({ title: "Inline", layout: "chips", items: INLINE_ACTIONS.map((id) => ({ ...action(id), run: () => runAction(view, QMD_ACTIONS[id]) })) });
  if (source) sections.push({ title: "Note", items: [{ label: "Edit Markdown source", icon: "code", run: source }] });
  return { label: "Insert", sections, width: 340 };
}

/** From paper…: puts the selection where the block goes, then opens the picker, which takes the focus. */
function fromPaperItem(view: EditorView, place: (() => void) | undefined, open: () => void): SectionPanelItem {
  return { label: "From paper…", icon: "book-open", hint: shortcutLabel(FROM_PAPER_KEY), run: () => { if (view.isDestroyed) return; place?.(); open(); } };
}

/** A new paragraph for a text style: the caret into the empty paragraph it is in, else a new empty paragraph after the selected block. */
function insertText(view: EditorView): void {
  const { selection } = view.state;
  const { $from } = selection;
  if (!($from.parent.type === qmdSchema.nodes.paragraph && $from.parent.content.size === 0)) {
    const tr = view.state.tr.insert(selection.to, qmdSchema.nodes.paragraph!.create());
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.to + 1)).scrollIntoView());
  }
  view.focus();
}

/**
 * The block choices of the empty note (plan D13): Cell (<language>), Equation and Diagram; its paragraph already takes text. Each choice first calls `place`, which puts the
 * selection where the block goes, then inserts there as the Insert panel does.
 */
export function blockChoiceItems(view: EditorView, language: CellLanguage, place: () => void): MenuItem[] {
  const choose = (insert: () => void) => () => { if (view.isDestroyed) return; place(); insert(); };
  const command = (run: Command) => choose(() => { runCommand(view, run); view.focus(); });
  const cell = (lang: CellLanguage): MenuItem => ({ label: `Cell (${cellLanguageLabel(lang)})`, icon: "code", onSelect: command(insertCodeCell(lang)) });
  return [
    cell(language),
    { label: "Equation", icon: QMD_ACTIONS.displayMath.icon, onSelect: command(QMD_ACTIONS.displayMath.command) },
    { label: "Figure", icon: QMD_ACTIONS.figure.icon, onSelect: command(QMD_ACTIONS.figure.command) },
  ];
}
