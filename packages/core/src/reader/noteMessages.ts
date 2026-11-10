// Handles the reader messages that write the paper's notes.qmd: note add, edit, move, colour and remove, each followed by the full list, and answers the prose math (evalMath).
import { formatError } from "../errors/index.js";
import { isAnnotationColor } from "../model/index.js";
import type { MathResult } from "../qmd/compute/index.js";
import { parseAnchor, type ItemAnchor, type ItemFile } from "../qmd/item/index.js";
import { createCellRuns, unsupportedNoteFileReply, type NoteFileRequest, type PaperNotesStore } from "../qmd/index.js";
import type { ReaderNote, WebviewToHost } from "./protocol/index.js";
import { READER_LOG_MODULE, type HostContext, type MessageAnswers, type ReaderHostPorts } from "./hostPorts.js";

const PREVIEW_NOTE_REFUSAL = "Notes are not saved in a build preview.";

/** @returns the items of the file as the reader shows them, in file order. */
function readerNotes(file: ItemFile): ReaderNote[] {
  const notes: ReaderNote[] = [];
  for (const segment of file.segments) {
    if (segment.kind !== "item") { continue; }
    const color = segment.attrs.find(([key]) => key === "color")?.[1];
    notes.push({
      id: segment.id,
      anchor: segment.attrs.find(([key]) => key === "anchor")?.[1] ?? "",
      body: segment.body,
      created: segment.created ?? "",
      author: segment.author ?? "",
      ...(isAnnotationColor(color) ? { color } : {}),
    });
  }
  return notes;
}

/** @returns the notes of the paper, or none when the host has no notes store. */
export async function loadReaderNotes(notes: PaperNotesStore | undefined, paperId: string): Promise<ReaderNote[]> {
  return notes ? readerNotes(await notes.read(paperId)) : [];
}

function toAnchor(text: string): ItemAnchor {
  const anchor = parseAnchor(text);
  if (anchor.kind === "unknown") { throw new Error(`Unknown anchor: ${text}`); }
  return anchor;
}

/** A failed write becomes a notice, and the reader keeps the list it has. */
async function writeNote(
  ctx: HostContext,
  verb: "add" | "edit" | "move" | "remove",
  command: WebviewToHost["command"],
  write: (notes: PaperNotesStore, paperId: string) => Promise<unknown>,
): Promise<void> {
  const { notes, paper, logger, notify } = ctx.ports;
  if (!notes) {
    notify(PREVIEW_NOTE_REFUSAL, "info");
    ctx.pushNotes([], true);
    return;
  }
  try {
    await write(notes, paper.id);
    ctx.pushNotes(await loadReaderNotes(notes, paper.id), true);
  } catch (err) {
    void logger.error(READER_LOG_MODULE, err, { paperId: paper.id, command });
    notify(`Failed to ${verb} note: ${formatError(err)}`, "error");
  }
}

/** Request ids are made by each reader, so one registry serves every reader host. */
const cellRuns = createCellRuns();


/** Runs a note's cell, stores its output with the note, pushes `updateNotes`, then answers `cellState`. */
function runNoteCell(ctx: HostContext, msg: Extract<WebviewToHost, { command: "runCell" }>): Promise<void> {
  const { notes, paper, logger, runCell } = ctx.ports;
  const { itemId, label, code, language, requestId, params, preview } = msg;
  return cellRuns.run(notes ? runCell : undefined, { label, code, language, requestId, noteKey: paperNoteKey(paper.id), ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
    read: async () => {
      const item = notes ? (await notes.read(paper.id)).segments.find((s) => s.kind === "item" && s.id === itemId) : undefined;
      return item?.kind === "item" ? item.body : undefined;
    },
    write: (body) => notes ? notes.editItem(paper.id, itemId, body) : Promise.resolve(),
    push: async () => { ctx.pushNotes(await loadReaderNotes(notes, paper.id), true); },
    post: (state, info) => { ctx.ports.post({ type: "cellState", requestId, state, ...info }); },
    preview: (result) => { ctx.ports.post({ type: "cellPreview", requestId, result }); },
    fail: (error) => { void logger.error(READER_LOG_MODULE, error, { paperId: paper.id, command: "runCell" }); },
  });
}

// Answers the reader's evalMath: runs the prose math in the paper note's session and posts the result under the request's id.
/** The D2 note key: the cells and the math of one paper's notes share a session. */
const paperNoteKey = (paperId: string): string => `paper:${paperId}`;

const UNAVAILABLE: MathResult = { state: "failed", rewrites: [], messages: ["Math is not available here."] };

/** Runs one math request through the host's runner; nothing is written to the notes. A failed run still answers, so the reader never waits. */
async function evalMath(ctx: HostContext, msg: Extract<WebviewToHost, { command: "evalMath" }>): Promise<void> {
  const { paper, logger, runMath, post } = ctx.ports;
  const { requestId, itemId, op, tex } = msg;
  let result: MathResult;
  if (!runMath) {
    result = UNAVAILABLE;
  } else {
    try {
      result = await runMath({ noteKey: paperNoteKey(paper.id), op, tex });
    } catch (err) {
      void logger.error(READER_LOG_MODULE, err, { paperId: paper.id, command: "evalMath", itemId });
      result = { ...UNAVAILABLE, messages: [formatError(err)] };
    }
  }
  post({ type: "mathResult", requestId, result });
}

/** Posts the host's answer to a note file request, or an error reply where the host has no note files, so the editor never waits. */
export async function answerReaderNoteFile(ports: Pick<ReaderHostPorts, 'noteFiles' | 'post'>, request: NoteFileRequest): Promise<void> {
  ports.post(ports.noteFiles ? await ports.noteFiles(request) : unsupportedNoteFileReply(request));
}

export const noteHandlers: Pick<MessageAnswers, "addNote" | "editNote" | "moveNote" | "removeNote" | "colorNote" | "runCell" | "evalMath" | "restartCell" | "cancelCell" | "installPython" | "noteFile"> = {
  runCell: runNoteCell,
  evalMath,
  restartCell: (ctx, msg) => ctx.ports.restartCell?.(paperNoteKey(ctx.ports.paper.id), msg.language),
  cancelCell: (_ctx, msg) => { cellRuns.cancel(msg.requestId); },
  installPython: (ctx) => { ctx.ports.installPython?.(); },
  noteFile: (ctx, msg) => answerReaderNoteFile(ctx.ports, msg.request),

  addNote: (ctx, msg) =>
    writeNote(ctx, "add", msg.command, (notes, id) => notes.addItem(id, { anchor: toAnchor(msg.anchor), body: msg.body })),

  editNote: (ctx, msg) => writeNote(ctx, "edit", msg.command, (notes, id) => notes.editItem(id, msg.id, msg.body)),

  // Only the anchor attribute changes; the body and the other attributes stay as they are.
  moveNote: (ctx, msg) => writeNote(ctx, "move", msg.command, (notes, id) => notes.setAnchor(id, msg.id, toAnchor(msg.anchor))),

  removeNote: (ctx, msg) => writeNote(ctx, "remove", msg.command, (notes, id) => notes.removeItem(id, msg.id)),

  colorNote: (ctx, msg) => writeNote(ctx, "edit", msg.command, (notes, id) => notes.setAttribute(id, msg.id, "color", msg.color)),
};
