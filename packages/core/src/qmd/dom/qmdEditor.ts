// Mounts the rich editor of a LabShelf Markdown item body: ProseMirror state, keymap, input rules, the Visual/Source toggle and optional collab.
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import type { CellLanguage } from "../compute/index.js";
import { createCodeCellView } from "./codeCellView.js";
import { createOutputView } from "./outputView.js";
import { createCitationView, createLinkView, createTaskItemView } from "./inlineViews.js";
import { blockDragPlugin, blockNavigationPlugin, placeCaretForInsert, placeCaretFromClick } from "./qmdBlocks.js";
import { createMathView } from "./mathView.js";
import { editRequestPlugin, qmdKeymap, shortcutLabel } from "./qmdCommands.js";
import { codeFenceEnter, qmdInputRules } from "./qmdInputRules.js";
import { liftItem, sinkItem, splitItem } from "./qmdListCommands.js";
import { mountSelectionBubble, renderInsertButton, showInsertMenu } from "./qmdControls.js";

/** `status` is a host element (a save status, say) shown at the right of the row under the text. */
export interface QmdEditorOptions { body: string; onChange(body: string): void; status?: HTMLElement; onRunCell?(label: string, code: string, language: CellLanguage): void; onRestartCell?(language: CellLanguage): void; onOpenLink?(href: string): void; readOnly?: boolean; meta?: { author?: string; date?: string }; collab?: { fragment: Y.XmlFragment; awareness: Awareness } }

export interface QmdEditorHandle { setBody(body: string): void; flush(): void; focus(): void; destroy(): void }

const CHANGE_DELAY_MS = 300;
const TOGGLE_KEY = "Mod-Alt-s";
/** Marks transactions that replace the content from outside, which must not report a change. */
const EXTERNAL = "qmdExternal";

/** UI words for a LabShelf Markdown item (D16); renaming "note" is a change here only. */
export const QMD_VOCABULARY: { readonly item: string } = { item: "note" };

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

interface Chrome { header: HTMLElement; toggle: HTMLButtonElement; footer: HTMLElement; source: HTMLTextAreaElement }

/** The mutable state one mounted editor shares between its functions. */
interface Session { options: QmdEditorOptions; readOnly: boolean; chrome: Chrome; view: EditorView; changed: Debouncer<[]>; mode: "visual" | "source"; destroyed: boolean; createState(body: string): EditorState }

function createChrome(options: QmdEditorOptions, readOnly: boolean): Chrome {
  const header = renderElement("div", { class: "qmd-editor-header" });
  const metaText = [options.meta?.author, options.meta?.date].filter((part) => part).join(" · ");
  if (metaText) header.append(renderElement("span", { class: "qmd-editor-meta", text: metaText }));
  const toggle = renderElement("button", { class: "ls-btn ls-btn-ghost qmd-editor-toggle", type: "button" });
  header.append(toggle);
  // The row under the text: the Insert button on the left, the host's status on the right.
  const footer = renderElement("div", { class: "qmd-editor-footer" });
  if (options.status) footer.append(options.status);
  footer.hidden = readOnly && !options.status;
  const source = renderElement("textarea", { class: "qmd-editor-source", spellcheck: "false" });
  source.readOnly = readOnly;
  return { header, toggle, footer, source };
}

const chainEnter: Command = (state, dispatch, view) => codeFenceEnter(state, dispatch, view) || splitItem(state, dispatch, view);

function createPlugins(options: QmdEditorOptions, toggleCommand: Command): Plugin[] {
  const { collab } = options;
  const plugins: Plugin[] = [qmdInputRules(), placeholderPlugin(`Empty ${QMD_VOCABULARY.item} — type to start`), editRequestPlugin(), blockNavigationPlugin(), blockDragPlugin()];
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
      code_cell: createCodeCellView(options.onRunCell, options.onRestartCell),
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
  const { source } = chrome;
  const insert = chrome.footer.querySelector<HTMLElement>(".qmd-editor-insert");
  if (session.mode === "visual") {
    source.value = docToBody(view.state.doc);
    session.mode = "source";
    if (insert) insert.hidden = true;
    view.dom.replaceWith(source);
    source.focus();
  } else {
    const body = source.value;
    session.mode = "visual";
    if (insert) insert.hidden = readOnly;
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
  root.replaceChildren(chrome.header, view.dom, chrome.footer);
  const onEmptyClick = (event: MouseEvent): void => {
    const onSpace = event.target === root || event.target === view.dom;
    if (onSpace && event.button === 0 && session.mode === "visual" && !session.readOnly && placeCaretFromClick(view, event)) event.preventDefault();
  };
  root.addEventListener("mousedown", onEmptyClick);
  // A double click on empty space opens the Insert menu there, inserting at that spot.
  const onEmptyDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0 || session.mode !== "visual" || session.readOnly || !placeCaretForInsert(view, event)) return;
    event.preventDefault();
    showInsertMenu(view, { x: event.clientX, y: event.clientY }, () => toggleMode(session));
  };
  root.addEventListener("dblclick", onEmptyDoubleClick);
  if (!session.readOnly) chrome.footer.prepend(renderInsertButton(view, () => toggleMode(session)));
  const bubble = session.readOnly ? null : mountSelectionBubble(root, view);
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
      bubble?.destroy();
      root.removeEventListener("mousedown", onEmptyClick);
      root.removeEventListener("dblclick", onEmptyDoubleClick);
      view.destroy();
      root.replaceChildren();
      root.classList.remove("qmd-editor");
    },
  };
}
