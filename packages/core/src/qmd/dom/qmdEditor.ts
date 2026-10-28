// Mounts the rich editor of a LabShelf Markdown item body: ProseMirror state, keymap, input rules, the Visual/Source toggle and optional collab.
import { baseKeymap } from "prosemirror-commands";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import type { Node as ProseNode } from "prosemirror-model";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, type Command, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import { createCodeCellView, createOutputView } from "./codeCellView.js";
import { createCitationView, createLinkView, createTaskItemView } from "./inlineViews.js";
import { createMathView } from "./mathView.js";
import { liftItem, qmdKeymap, shortcutLabel, sinkItem, splitItem } from "./qmdCommands.js";
import { mountQmdToolbar } from "./qmdToolbar.js";

export interface QmdEditorOptions { body: string; onChange(body: string): void; onRunCell?(label: string, code: string): void; onOpenLink?(href: string): void; readOnly?: boolean; meta?: { author?: string; date?: string }; collab?: { fragment: Y.XmlFragment; awareness: Awareness } }

export interface QmdEditorHandle { setBody(body: string): void; focus(): void; destroy(): void }

const CHANGE_DELAY_MS = 300;
const TOGGLE_KEY = "Mod-Alt-s";
/** Marks transactions that replace the content from outside, which must not report a change. */
const EXTERNAL = "qmdExternal";

/** UI words for a LabShelf Markdown item (D16); renaming "note" is a change here only. */
export const QMD_VOCABULARY: { readonly item: string } = { item: "note" };

const bulletList = qmdSchema.nodes.bullet_list!;
const codeCell = qmdSchema.nodes.code_cell!;
const heading = qmdSchema.nodes.heading!;
const listItem = qmdSchema.nodes.list_item!;
const mathDisplay = qmdSchema.nodes.math_display!;
const mathInline = qmdSchema.nodes.math_inline!;
const orderedList = qmdSchema.nodes.ordered_list!;
const paragraph = qmdSchema.nodes.paragraph!;
const taskItem = qmdSchema.nodes.task_item!;

/** `[ ] ` or `[x] ` at the start of a paragraph makes a task item, turning a fresh bullet item into one in place. */
const taskRule = new InputRule(/^\[( |x|X)\]\s$/, (state, match, start, end) => {
  const checked = match[1] !== " ";
  const attrs = { checked, mark: checked ? (match[1] as string) : "x" };
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph) return null;
  const tr = state.tr.delete(start, end);
  if ($start.depth >= 2 && $start.node(-1).type === listItem && $start.index(-1) === 0 && $start.node(-2).type === bulletList) {
    return tr.setNodeMarkup($start.before(-1), taskItem, attrs);
  }
  const range = tr.doc.resolve(start).blockRange();
  if (!range) return null;
  try {
    return tr.wrap(range, [{ type: bulletList }, { type: taskItem, attrs }]);
  } catch {
    return null;
  }
});

/** `$tex$` becomes inline math. */
const inlineMathRule = new InputRule(/(?:^|[^$\\])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
  const lead = match[0].startsWith("$") ? 0 : 1;
  return state.tr.replaceWith(start + lead, end, mathInline.create({ tex: match[1] }));
});

/** Replaces the paragraph holding `start` by `node` when the matched text is all it holds. */
function replaceWholeParagraph(state: EditorState, start: number, end: number, create: () => ProseNode): Transaction | null {
  const $start = state.doc.resolve(start);
  if ($start.parent.type !== paragraph || $start.parentOffset !== 0 || end - $start.start() !== $start.parent.content.size) return null;
  return state.tr.replaceWith($start.before(), $start.after(), create());
}

/** `$$` on an empty line becomes display math. */
const displayMathRule = new InputRule(/^\$\$$/, (state, _match, start, end) => replaceWholeParagraph(state, start, end, () => mathDisplay.create()));

/** Three backticks followed by `python` (or `{python}`) and a space become a Python code cell. */
const codeCellRule = new InputRule(/^```\{?python\}?\s$/, (state, _match, start, end) => replaceWholeParagraph(state, start, end, () => codeCell.create({ lang: "python" })));

/** The input rules plugin of the qmd editor. */
function qmdInputRules(): Plugin {
  return inputRules({
    rules: [
      textblockTypeInputRule(/^(#{1,6})\s$/, heading, (match) => ({ level: (match[1] as string).length })),
      taskRule,
      wrappingInputRule(/^\s*([-+*])\s$/, bulletList, (match) => ({ marker: match[1] })),
      wrappingInputRule(
        /^(\d+)([.)])\s$/,
        orderedList,
        (match) => ({ order: Number(match[1]), delimiter: match[2] }),
        (match, node) => node.childCount + (node.attrs.order as number) === Number(match[1]),
      ),
      displayMathRule,
      inlineMathRule,
      codeCellRule,
    ],
  });
}

/** Shows the empty-item placeholder through a node decoration with a class. */
function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        const first = doc.firstChild;
        if (doc.childCount !== 1 || !first || first.type !== qmdSchema.nodes.paragraph || first.content.size > 0) return null;
        return DecorationSet.create(doc, [Decoration.node(0, first.nodeSize, { class: "qmd-editor-placeholder", "data-placeholder": text })]);
      },
    },
  });
}

/** Opens links through `onOpenLink` instead of navigating the host page. */
function linkPlugin(onOpenLink: (href: string) => void): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(_view, event) {
          const anchor = (event.target as Element | null)?.closest?.("a[href]");
          if (!anchor) return false;
          event.preventDefault();
          onOpenLink(anchor.getAttribute("href") ?? "");
          return true;
        },
      },
    },
  });
}

/** Remote cursors drawn with classes only: the webview CSP forbids inline styles. */
function collabCursor(user: { name?: string }): HTMLElement {
  return renderElement("span", { class: "qmd-editor-cursor" }, "⁠", renderElement("span", { class: "qmd-editor-cursor-name", text: user.name ?? "" }), "⁠");
}

interface Chrome { header: HTMLElement; toggle: HTMLButtonElement; toolbar: HTMLElement; source: HTMLTextAreaElement }

/** The mutable state one mounted editor shares between its functions. */
interface Session { options: QmdEditorOptions; readOnly: boolean; chrome: Chrome; view: EditorView; changed: Debouncer<[]>; mode: "visual" | "source"; destroyed: boolean; createState(body: string): EditorState }

function createChrome(options: QmdEditorOptions, readOnly: boolean): Chrome {
  const header = renderElement("div", { class: "qmd-editor-header" });
  const metaText = [options.meta?.author, options.meta?.date].filter((part) => part).join(" · ");
  if (metaText) header.append(renderElement("span", { class: "qmd-editor-meta", text: metaText }));
  const toggle = renderElement("button", { class: "ls-btn ls-btn-ghost qmd-editor-toggle", type: "button" });
  header.append(toggle);
  const toolbar = renderElement("div", { class: "qmd-editor-toolbar" });
  toolbar.hidden = readOnly;
  const source = renderElement("textarea", { class: "qmd-editor-source", spellcheck: "false" });
  source.readOnly = readOnly;
  return { header, toggle, toolbar, source };
}

function createPlugins(options: QmdEditorOptions, toggleCommand: Command): Plugin[] {
  const { collab } = options;
  const plugins: Plugin[] = [qmdInputRules(), placeholderPlugin(`Empty ${QMD_VOCABULARY.item} — type to start`)];
  if (options.onOpenLink) plugins.push(linkPlugin(options.onOpenLink));
  if (collab) {
    plugins.push(
      ySyncPlugin(collab.fragment),
      yCursorPlugin(collab.awareness, { cursorBuilder: collabCursor, selectionBuilder: () => ({ class: "qmd-editor-selection" }) }),
      // y-prosemirror's typings resolve their own prosemirror-state copy, so its plugin and commands are cast at this seam.
      yUndoPlugin() as unknown as Plugin,
      keymap({ "Mod-z": undoCommand as unknown as Command, "Mod-Shift-z": redoCommand as unknown as Command, "Mod-y": redoCommand as unknown as Command }),
    );
  } else {
    plugins.push(history(), keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }));
  }
  plugins.push(keymap(qmdKeymap()), keymap({ Enter: splitItem, Tab: sinkItem, "Shift-Tab": liftItem, [TOGGLE_KEY]: toggleCommand }), keymap(baseKeymap));
  return plugins;
}

function createView(session: Session): EditorView {
  const { options, readOnly } = session;
  const view: EditorView = new EditorView(null, {
    state: session.createState(options.body),
    editable: () => !readOnly,
    nodeViews: {
      math_inline: createMathView(false),
      math_display: createMathView(true),
      code_cell: createCodeCellView(options.onRunCell),
      output: createOutputView(),
      task_item: createTaskItemView(),
      citation: createCitationView(),
    },
    markViews: { link: createLinkView() },
    // PLATFORM: without layout (jsdom, a detached host) ranges have no client rects and ProseMirror's scroll throws.
    handleScrollToSelection: () => typeof document.createRange().getClientRects !== "function",
    dispatchTransaction(tr) {
      if (session.destroyed) return;
      view.updateState(view.state.apply(tr));
      if (tr.docChanged && !tr.getMeta(EXTERNAL)) session.changed.call();
    },
  });
  return view;
}

function currentBody(session: Session): string {
  return session.mode === "source" ? session.chrome.source.value : docToBody(session.view.state.doc);
}

/** Shows `body` without reporting a change. */
function showBody(session: Session, body: string): void {
  const { view } = session;
  if (!session.options.collab) {
    view.updateState(session.createState(body));
    return;
  }
  const doc = bodyToDoc(body);
  const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta(EXTERNAL, true);
  for (const [name, value] of Object.entries(doc.attrs)) tr.setDocAttribute(name, value);
  view.dispatch(tr);
}

function renderToggle(session: Session): void {
  const label = session.mode === "visual" ? "Source" : "Visual";
  const { toggle } = session.chrome;
  toggle.textContent = label;
  toggle.title = `${label} (${shortcutLabel(TOGGLE_KEY)})`;
  toggle.setAttribute("aria-pressed", String(session.mode === "source"));
}

function toggleMode(session: Session): void {
  const { view, chrome, readOnly } = session;
  const { source, toolbar } = chrome;
  if (session.mode === "visual") {
    source.value = docToBody(view.state.doc);
    session.mode = "source";
    toolbar.hidden = true;
    view.dom.replaceWith(source);
    source.focus();
  } else {
    const body = source.value;
    session.mode = "visual";
    toolbar.hidden = readOnly;
    source.replaceWith(view.dom);
    if (body !== docToBody(view.state.doc)) showBody(session, body);
    view.focus();
  }
  renderToggle(session);
}

function bindChrome(session: Session): void {
  const { toggle, source } = session.chrome;
  toggle.addEventListener("click", () => toggleMode(session));
  source.addEventListener("input", () => session.changed.call());
  source.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.altKey && !event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      toggleMode(session);
    }
  });
}

function createSession(options: QmdEditorOptions): Session {
  const readOnly = options.readOnly ?? false;
  const chrome = createChrome(options, readOnly);
  const toggleCommand: Command = () => {
    toggleMode(session);
    return true;
  };
  const plugins = createPlugins(options, toggleCommand);
  const session = {
    options,
    readOnly,
    chrome,
    mode: "visual",
    destroyed: false,
    changed: createDebouncer(() => {
      if (!session.destroyed) options.onChange(currentBody(session));
    }, CHANGE_DELAY_MS),
    createState: (body: string) => EditorState.create({ schema: qmdSchema, doc: bodyToDoc(body), plugins }),
  } as Session;
  session.view = createView(session);
  return session;
}

export function mountQmdEditor(root: HTMLElement, options: QmdEditorOptions): QmdEditorHandle {
  const session = createSession(options);
  const { chrome, view, changed } = session;
  bindChrome(session);
  root.classList.add("qmd-editor");
  root.replaceChildren(chrome.header, chrome.toolbar, view.dom);
  const toolbarHandle = session.readOnly ? null : mountQmdToolbar(chrome.toolbar, view);
  renderToggle(session);

  return {
    setBody(body) {
      if (session.destroyed) return;
      changed.cancel();
      if (session.mode === "source") chrome.source.value = body;
      else showBody(session, body);
    },
    focus() {
      if (session.mode === "source") chrome.source.focus();
      else view.focus();
    },
    destroy() {
      if (session.destroyed) return;
      session.destroyed = true;
      changed.cancel();
      toolbarHandle?.destroy();
      view.destroy();
      root.replaceChildren();
      root.classList.remove("qmd-editor");
    },
  };
}
