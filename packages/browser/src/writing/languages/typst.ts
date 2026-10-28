// Combines the Typst mode with completion, hover and definition from the core language service for one open file.
import { autocompletion, snippet, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap, type Tooltip } from "@codemirror/view";
import { deriveSnippetTemplate, type ILogger, type PaperRecord } from "@labshelf/core";
import {
  createTypstLanguageService,
  derivePlainHoverText,
  type TypstCompletion,
  type TypstCompletionKind,
  type TypstLanguageService,
  type TypstSources,
} from "@labshelf/core/typst/language";
import type { Workspace } from "../../libraryUi/editorArea";
import { showInOpenEditor } from "../session";
import { listLibraryCitations } from "./latex";

interface TypstState { comment: number; math: boolean }

const KEYWORDS = new Set(["let", "set", "show", "import", "include", "if", "else", "for", "while", "in", "return", "break", "continue", "context", "not", "and", "or", "none", "auto", "true", "false"]);

function blockComment(stream: Parameters<StreamParser<TypstState>["token"]>[0], state: TypstState): string {
  while (!stream.eol() && state.comment > 0) {
    if (stream.match("*/")) state.comment--;
    else if (stream.match("/*")) state.comment++;
    else stream.next();
  }
  return "comment";
}

function string(stream: Parameters<StreamParser<TypstState>["token"]>[0]): string {
  stream.next();
  for (let ch = stream.next(); ch != null && ch !== '"'; ch = stream.next()) if (ch === "\\") stream.next();
  return "string";
}

const parser: StreamParser<TypstState> = {
  name: "typst",
  startState: () => ({ comment: 0, math: false }),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
  token(stream, state) {
    if (state.comment > 0) return blockComment(stream, state);
    if (state.math) {
      if (stream.peek() === "$") { stream.next(); state.math = false; return "keyword"; }
      while (!stream.eol() && stream.peek() !== "$") if (stream.next() === "\\") stream.next();
      return "variableName.special";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { state.comment = 1; return blockComment(stream, state); }
    if (stream.eat("$")) { state.math = true; return "keyword"; }
    if (stream.sol() && stream.match(/^=+(?=\s)/)) { stream.skipToEnd(); return "heading"; }
    if (stream.peek() === '"') return string(stream);
    if (stream.match(/^#[A-Za-z_][\w-]*/)) return KEYWORDS.has(stream.current().slice(1)) ? "keyword" : "variable";
    if (stream.match(/^(<[\w:.-]+>|@[\w:.-]+)/)) return "meta";
    if (stream.match(/^\*[^*\n]+\*/)) return "strong";
    if (stream.match(/^_[^_\n]+_/)) return "emphasis";
    stream.next();
    return null;
  },
};

const hoverTheme = EditorView.theme({
  ".cm-typst-hover": { padding: "var(--ls-space-2) var(--ls-space-3)", whiteSpace: "pre-wrap", maxWidth: "40em", fontFamily: "var(--ls-mono)" },
});

export const typstLanguage: Extension = [StreamLanguage.define(parser), hoverTheme];

const TYPES: Record<TypstCompletionKind, string> = {
  function: "function", variable: "variable", keyword: "keyword", label: "constant", citation: "constant",
  file: "text", parameter: "property", module: "namespace", type: "type", value: "constant",
};

function toCompletion(item: TypstCompletion): Completion {
  return {
    label: item.label,
    type: TYPES[item.kind],
    ...(item.detail !== undefined && { detail: item.detail }),
    ...(item.doc !== undefined && { info: item.doc }),
    apply: item.snippet ? snippet(deriveSnippetTemplate(item.insert)) : item.insert,
  };
}

async function libraryItems(papers: () => Promise<readonly PaperRecord[]>, afterAt: boolean): Promise<{ options: Completion[]; keys: Set<string> }> {
  if (!afterAt) return { options: [], keys: new Set() };
  const all = await papers();
  return { options: await listLibraryCitations(async () => all), keys: new Set(all.map((paper) => paper.citeKey)) };
}

export function createTypstCompletion(service: TypstLanguageService, path: string, papers: () => Promise<readonly PaperRecord[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/[\w-]*/)!;
    const before = context.state.sliceDoc(Math.max(0, word.from - 1), word.from);
    if (!context.explicit && word.from === word.to && !/[#@.(]/.test(before)) return null;
    const result = await service.complete(path, context.state.doc.toString(), context.pos, context.explicit);
    const library = await libraryItems(papers, before === "@");
    const items = (result?.options ?? []).filter((item) => !library.keys.has(item.label));
    if (!result && library.options.length === 0) return null;
    return {
      from: result?.from ?? word.from,
      ...(result && { to: result.to }),
      options: [...library.options, ...items.map(toCompletion)],
    };
  };
}

export interface DefinitionDeps {
  projectId: string;
  openTab: Workspace["openTab"];
}

async function goToDefinition(
  view: EditorView, service: TypstLanguageService, path: string, pos: number, target: DefinitionDeps,
): Promise<void> {
  const definition = await service.definition(path, view.state.doc.toString(), pos);
  if (!definition) return;
  target.openTab("source", { projectId: target.projectId, path: definition.path }, 0);
  showInOpenEditor(target.projectId, definition.path, definition.line);
}

/** F12 and Ctrl/Cmd+click go to the definition. */
export function createDefinitionBindings(service: TypstLanguageService, path: string, target: DefinitionDeps): Extension {
  return [
    Prec.high(keymap.of([{ key: "F12", run: (view) => { void goToDefinition(view, service, path, view.state.selection.main.head, target); return true; } }])),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        event.preventDefault();
        void goToDefinition(view, service, path, pos, target);
        return true;
      },
    }),
  ];
}

/** For `hoverTooltip`: the tooltip is plain text, since the service answers in markdown. */
function hoverSource(service: TypstLanguageService, path: string): (view: EditorView, pos: number, side: -1 | 1) => Promise<Tooltip | null> {
  return async (view, pos) => {
    const hover = await service.hover(path, view.state.doc.toString(), pos);
    const text = hover ? derivePlainHoverText(hover.text) : "";
    if (!hover || text === "") return null;
    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-typst-hover";
        dom.textContent = text;
        return { dom };
      },
    };
  };
}

export interface TypstSupportDeps extends DefinitionDeps {
  path: string;
  files: TypstSources;
  logger: ILogger;
  papers(): Promise<readonly PaperRecord[]>;
}

/** The service reads the editor's text on every call, so unsaved edits count. */
export function createTypstSupport(deps: TypstSupportDeps): Extension {
  const service = createTypstLanguageService({ sources: deps.files, logger: deps.logger });
  return [
    typstLanguage,
    autocompletion({ override: [createTypstCompletion(service, deps.path, deps.papers)] }),
    hoverTooltip(hoverSource(service, deps.path)),
    createDefinitionBindings(service, deps.path, deps),
  ];
}
