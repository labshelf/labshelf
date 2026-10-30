// Mounts the rich editor of a LabShelf Markdown item body: ProseMirror state, keymap, input rules, the Visual/Source toggle and optional collab.
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, TextSelection, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import { createCodeCellView } from "./codeCellView.js";
import { createOutputView } from "./outputView.js";
import { createCitationView, createLinkView, createTaskItemView, editNodeAt } from "./inlineViews.js";
import { createMathView } from "./mathView.js";
import { editRequestPlugin, qmdKeymap, shortcutLabel } from "./qmdCommands.js";
import { codeFenceEnter, qmdInputRules } from "./qmdInputRules.js";
import { liftItem, sinkItem, splitItem } from "./qmdListCommands.js";
import { mountQmdToolbar } from "./qmdToolbar.js";

export interface QmdEditorOptions { body: string; onChange(body: string): void; onRunCell?(label: string, code: string): void; onOpenLink?(href: string): void; readOnly?: boolean; meta?: { author?: string; date?: string }; collab?: { fragment: Y.XmlFragment; awareness: Awareness } }

export interface QmdEditorHandle { setBody(body: string): void; flush(): void; focus(): void; destroy(): void }

const CHANGE_DELAY_MS = 300;
const TOGGLE_KEY = "Mod-Alt-s";
/** Marks transactions that replace the content from outside, which must not report a change. */
const EXTERNAL = "qmdExternal";

/** UI words for a LabShelf Markdown item (D16); renaming "note" is a change here only. */
export const QMD_VOCABULARY: { readonly item: string } = { item: "note" };

const codeCell = qmdSchema.nodes.code_cell!;

/** Arrow keys at the edge of a textblock next to a code cell move the caret into the cell's code. */
const enterCellKeys: Record<string, { dir: 1 | -1; edge: "up" | "down" | "left" | "right" }> = {
  ArrowDown: { dir: 1, edge: "down" }, ArrowRight: { dir: 1, edge: "right" }, ArrowUp: { dir: -1, edge: "up" }, ArrowLeft: { dir: -1, edge: "left" },
};

function cellNavigationPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const key = enterCellKeys[event.key];
        const selection = view.state.selection;
        if (!key || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || !(selection instanceof TextSelection) || !selection.empty) return false;
        const { $from } = selection;
        if ($from.depth < 1 || !view.endOfTextblock(key.edge)) return false;
        const edge = key.dir > 0 ? $from.after() : $from.before();
        const $edge = view.state.doc.resolve(edge);
        const neighbour = key.dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
        if (neighbour?.type !== codeCell) return false;
        return editNodeAt(view, key.dir > 0 ? edge : edge - neighbour.nodeSize, key.dir > 0 ? "start" : "end");
      },
    },
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

const chainEnter: Command = (state, dispatch, view) => codeFenceEnter(state, dispatch, view) || splitItem(state, dispatch, view);

function createPlugins(options: QmdEditorOptions, toggleCommand: Command): Plugin[] {
  const { collab } = options;
  const plugins: Plugin[] = [qmdInputRules(), placeholderPlugin(`Empty ${QMD_VOCABULARY.item} — type to start`), editRequestPlugin(), cellNavigationPlugin()];
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
  plugins.push(keymap(qmdKeymap()), keymap({ Enter: chainEnter, Tab: sinkItem, "Shift-Tab": liftItem, [TOGGLE_KEY]: toggleCommand }), keymap(baseKeymap));
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

/** Shows `body` without reporting a change, replacing only the blocks that differ so the caret stays where it was. */
function showBody(session: Session, body: string): void {
  const { view } = session;
  const doc = bodyToDoc(body);
  const current = view.state.doc.content;
  const tr = view.state.tr.setMeta(EXTERNAL, true).setMeta("addToHistory", false);
  const start = current.findDiffStart(doc.content);
  if (start !== null) {
    const ends = current.findDiffEnd(doc.content)!;
    // Both ends step back over a run the two bodies share, so they never cross the start.
    const overlap = Math.max(0, start - Math.min(ends.a, ends.b));
    tr.replace(start, ends.a + overlap, doc.slice(start, ends.b + overlap));
  }
  for (const [name, value] of Object.entries(doc.attrs)) tr.setDocAttribute(name, value);
  view.dispatch(tr);
}

function renderToggle(session: Session): void {
  const label = session.mode === "visual" ? "Source" : "Visual";
  const { toggle, header } = session.chrome;
  toggle.hidden = session.mode === "visual" && !session.readOnly;
  header.hidden = toggle.hidden && !header.querySelector(".qmd-editor-meta");
  header.parentElement?.setAttribute("data-qmd-mode", session.mode);
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
  const toolbarHandle = session.readOnly ? null : mountQmdToolbar(chrome.toolbar, view, () => toggleMode(session));
  renderToggle(session);

  return {
    setBody(body) {
      if (session.destroyed) return;
      changed.cancel();
      if (session.mode === "source") chrome.source.value = body;
      else showBody(session, body);
    },
    flush() { changed.flush(); },
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
