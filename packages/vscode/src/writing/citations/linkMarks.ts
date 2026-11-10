// What the note links and the code links of a manuscript share in the native editor: the manuscript's format, the hover's command links, the block insert at the cursor and the side-by-side comparison.
import * as vscode from "vscode";

export type ManuscriptLanguage = "latex" | "typst";

/** The manuscript format of a native document; undefined for any other language. */
export function readManuscriptLanguage(document: vscode.TextDocument): ManuscriptLanguage | undefined {
  const language = document.languageId;
  return language === "latex" || language === "typst" ? language : undefined;
}

const escapeMarkdown = (text: string): string => text.replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, "\\$&");

/** A markdown link that runs `command` with the document and the 0-based line of a mark. */
export function commandLink(title: string, command: string, document: vscode.TextDocument, line: number): string {
  return `[${title}](command:${command}?${encodeURIComponent(JSON.stringify([document.uri.toString(), line]))})`;
}

/** The hover of a mark: its sentence, then its actions; the commands the links run are trusted. */
export function createMarkHover(sentence: string, actions: readonly string[], commands: string[], range: vscode.Range): vscode.Hover {
  const markdown = new vscode.MarkdownString([escapeMarkdown(sentence), actions.join(" · ")].filter((part) => part !== "").join("\n\n"));
  markdown.isTrusted = { enabledCommands: commands };
  return new vscode.Hover(markdown, range);
}

/** The block text for a cursor whose line holds `before` and `after` around it, so the block sits on lines of its own. */
export function deriveBlockText(text: string, before: string, after: string): string {
  return `${before.trim() === "" ? "" : "\n"}${text}${after.trim() === "" ? "" : "\n"}`;
}

/** Replaces the editor's selection with the block on lines of its own. */
export function insertBlock(editor: vscode.TextEditor, text: string): Thenable<boolean> {
  const { document, selection } = editor;
  const before = document.lineAt(selection.start.line).text.slice(0, selection.start.character);
  const after = document.lineAt(selection.end.line).text.slice(selection.end.character);
  return editor.edit((builder) => builder.replace(selection, deriveBlockText(text, before, after)));
}

/** Virtual documents for `vscode.diff`, kept per manuscript until it closes. */
export class DiffDocuments {
  private readonly texts = new Map<string, string>();
  private readonly owned = new Map<string, string[]>();
  private count = 0;

  constructor(private readonly scheme: string) {}

  register(): vscode.Disposable {
    return vscode.workspace.registerTextDocumentContentProvider(this.scheme, { provideTextDocumentContent: (uri) => this.texts.get(uri.toString()) ?? "" });
  }

  /** Opens the two texts side by side; the names end the virtual paths, so their extensions pick the highlighting. */
  async open(owner: vscode.Uri, left: { name: string; text: string }, right: { name: string; text: string }, title: string): Promise<void> {
    const id = ++this.count;
    const uris = [left, right].map((side) => {
      const uri = vscode.Uri.parse(`${this.scheme}:/${id}/${side.name}`);
      this.texts.set(uri.toString(), side.text);
      return uri;
    });
    const key = owner.toString();
    this.owned.set(key, [...(this.owned.get(key) ?? []), ...uris.map((uri) => uri.toString())]);
    await vscode.commands.executeCommand("vscode.diff", uris[0], uris[1], title);
  }

  forget(owner: vscode.Uri): void {
    const key = owner.toString();
    for (const uri of this.owned.get(key) ?? []) { this.texts.delete(uri); }
    this.owned.delete(key);
  }
}
