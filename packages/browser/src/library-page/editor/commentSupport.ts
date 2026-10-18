// Connects the editor to the project's comment threads: marks anchored ranges and adds a comment on the selection.
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { ILogger, TextRange } from "@labshelf/core";
import { inputBox, toast } from "@labshelf/core/dom";
import { addCommentSupport } from "./addComment";
import { commentMarks } from "./commentMarks";
import { docOffsetToFile, fileOffsetToDoc } from "./commentOffsets";

const MODULE = "editor.comments";

/** What the editor needs from the comment threads of its file; ranges are offsets in the saved file text. */
export interface EditorComments {
  /** The listener runs with the ranges of the file's unresolved threads now and after each change. */
  subscribe(listener: (ranges: TextRange[]) => void): () => void;
  add(range: TextRange, text: string): Promise<void>;
  /** Opens the comments tab. */
  open(): void;
}

export interface CommentSupportDeps {
  comments: EditorComments;
  lineBreak: string;
  /** The text last written to the file. */
  savedText(): string;
  /** Saves pending edits; resolves whether the file is saved afterwards. */
  flush(): Promise<boolean>;
  logger: ILogger;
}

export interface CommentSupport {
  extensions: Extension[];
  /** Starts following the file's threads; returns the stop function. */
  attach(view: EditorView): () => void;
}

export function commentSupport(deps: CommentSupportDeps): CommentSupport {
  const { comments, logger } = deps;
  const marks = commentMarks(comments.open);
  let view: EditorView | undefined;
  // The saved file is what the store anchors the thread in, so the edits are written before the offsets are read.
  const addOnSelection = async (range: TextRange): Promise<void> => {
    const text = await inputBox({ title: "Add comment", prompt: "Comment on the selected text", validate: (value) => (value.trim() ? null : "Write a comment") });
    if (!text || !view) return;
    if (!(await deps.flush())) { toast("Could not save the file, so the comment was not added.", "error"); return; }
    const { doc } = view.state;
    await comments.add(
      { start: docOffsetToFile(doc, deps.lineBreak, range.start), end: docOffsetToFile(doc, deps.lineBreak, range.end) }, text,
    );
  };
  const add = (range: TextRange): void => {
    addOnSelection(range).catch((error: unknown) => {
      void logger.error(MODULE, error, { action: "addComment" });
      toast("Could not add the comment.", "error");
    });
  };
  return {
    extensions: [marks.extension, addCommentSupport(add)],
    attach(editorView) {
      view = editorView;
      return comments.subscribe((ranges) => marks.setRanges(editorView, ranges.map((range) => ({
        start: fileOffsetToDoc(deps.savedText(), range.start), end: fileOffsetToDoc(deps.savedText(), range.end),
      }))));
    },
  };
}
