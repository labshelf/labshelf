// Which source editor the user is working in (D7): the focused LabShelf editor or the native text editor, behind one interface so Build, Show in Preview, SyncTeX and the preview's focus follower do not care which.
import * as vscode from "vscode";

/** One open source editor. Lines are 1-based. */
export interface SourceView {
  uri: vscode.Uri;
  /** The line of the cursor. */
  line(): number;
  /** Scrolls the editor so the line is in the middle. */
  reveal(line: number): void;
  updates?: unknown;
}

export interface ActiveSource {
  /** The source editor the user last focused, native or LabShelf; a webview of another kind does not change it. */
  current(): SourceView | undefined;
  /** An open LabShelf editor on the file, focused or not. */
  openFor(uri: vscode.Uri): SourceView | undefined;
  onDidChange: vscode.Event<SourceView | undefined>;
  /** Adds an open LabShelf editor; `focused` fires true when it gains focus and false when it loses it. Dispose when its panel closes. */
  register(view: SourceView, focused: vscode.Event<boolean>): vscode.Disposable;
}

type NativeWindow = Pick<typeof vscode.window, "activeTextEditor" | "onDidChangeActiveTextEditor" | "onDidChangeTextEditorSelection">;

function wrapNative(editor: vscode.TextEditor): SourceView {
  return {
    uri: editor.document.uri,
    line: () => editor.selection.active.line + 1,
    reveal: (line) => {
      const position = Math.max(0, line - 1);
      editor.revealRange(new vscode.Range(position, 0, position, 0), vscode.TextEditorRevealType.InCenter);
    },
  };
}

export function createActiveSource(window: NativeWindow): ActiveSource {
  const changed = new vscode.EventEmitter<SourceView | undefined>();
  const registered: SourceView[] = [];
  // One wrapper per editor, so focusing the same editor again is not a change.
  const natives = new WeakMap<vscode.TextEditor, SourceView>();
  const native = (editor: vscode.TextEditor | undefined): SourceView | undefined => {
    if (!editor) { return undefined; }
    const known = natives.get(editor) ?? wrapNative(editor);
    natives.set(editor, known);
    return known;
  };
  let current = native(window.activeTextEditor);
  const setCurrent = (view: SourceView | undefined): void => {
    if (current === view) { return; }
    current = view;
    changed.fire(view);
  };
  // A native editor losing focus to a webview reports no editor; the last source stays current.
  window.onDidChangeActiveTextEditor((editor) => { if (editor) { setCurrent(native(editor)); } });
  return {
    current: () => current,
    openFor(uri) {
      const key = uri.toString();
      const matches = registered.filter((view) => view.uri.toString() === key);
      return current && matches.includes(current) ? current : matches[matches.length - 1];
    },
    onDidChange: changed.event,
    register(view, focused) {
      registered.push(view);
      const subscription = focused((isFocused) => { if (isFocused) { setCurrent(view); } });
      return {
        dispose() {
          subscription.dispose();
          const index = registered.indexOf(view);
          if (index >= 0) { registered.splice(index, 1); }
          if (current === view) { setCurrent(native(window.activeTextEditor)); }
        },
      };
    },
  };
}
