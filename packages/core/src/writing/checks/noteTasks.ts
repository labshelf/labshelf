/** Reads the `- [ ]` / `- [x]` task lines of a project's `.qmd` notes as Checklist items and ticks one by editing its note. */
import {
  OUTPUT_CLASS, extractLineContent, findCodeFences, findTopLevelDivs, parseDivOpener, parseItemFile, splitLines,
} from "../../qmd/item/index.js";
import type { ProjectNotesStore } from "../../qmd/index.js";

export interface NoteTask { file: string; itemId: string; line: number; text: string; done: boolean }

const TASK = /^([ \t]*[-*+][ \t]+\[)([ xX])(\][ \t]+)(.*\S.*)$/;
const BOM = "﻿";

interface LocatedTask extends NoteTask {
  /** Zero-based line inside the item body. */
  bodyLine: number;
}

/** Zero-based indices of the body lines inside code fences and output blocks. */
function skippedLines(lines: readonly string[]): Set<number> {
  const skipped = new Set<number>();
  for (const [open, close] of findCodeFences(lines)) {
    for (let i = open; i <= close; i++) { skipped.add(i); }
  }
  for (const { open, close } of findTopLevelDivs(lines)) {
    if (!parseDivOpener(extractLineContent(lines[open]!))?.classes.includes(OUTPUT_CLASS)) { continue; }
    for (let i = open; i <= close; i++) { skipped.add(i); }
  }
  return skipped;
}

function locateTasks(file: string, text: string): { tasks: LocatedTask[]; bodies: Map<string, string> } {
  const tasks: LocatedTask[] = [];
  const bodies = new Map<string, string>();
  let line = 0;
  parseItemFile(text).segments.forEach((segment, index) => {
    if (segment.kind === "loose") {
      line += splitLines(index === 0 && segment.text.startsWith(BOM) ? segment.text.slice(BOM.length) : segment.text).length;
      return;
    }
    const bodyLines = splitLines(segment.body);
    const skipped = skippedLines(bodyLines);
    bodyLines.forEach((content, bodyLine) => {
      if (skipped.has(bodyLine)) { return; }
      const match = TASK.exec(extractLineContent(content));
      if (!match) { return; }
      tasks.push({ file, itemId: segment.id, line: line + 1 + bodyLine, bodyLine, text: match[4]!.trimEnd(), done: match[2] !== " " });
    });
    if (!bodies.has(segment.id)) { bodies.set(segment.id, segment.body); }
    line += splitLines(segment.fence).length + bodyLines.length + splitLines(segment.close).length;
  });
  return { tasks, bodies };
}

/** @param text the whole `.qmd` text; only lines inside `.labshelf-item` blocks count, code cells and output blocks excluded */
export function scanNoteTasks(file: string, text: string): NoteTask[] {
  return locateTasks(file, text).tasks.map(({ bodyLine: _bodyLine, ...task }) => task);
}

/** Flips the task's box through the store. Writes nothing and returns status "changed" unless the note has that exact task on that line. */
export async function toggleNoteTask(
  store: ProjectNotesStore, projectId: string, task: NoteTask,
): Promise<{ status: "ok" } | { status: "changed" }> {
  const text = await store.read(projectId, task.file);
  if (text === null) { return { status: "changed" }; }
  const { tasks, bodies } = locateTasks(task.file, text);
  const current = tasks.find((candidate) => candidate.itemId === task.itemId && candidate.line === task.line);
  const body = bodies.get(task.itemId);
  if (!current || body === undefined || current.text !== task.text || current.done !== task.done) { return { status: "changed" }; }
  const lines = splitLines(body);
  const original = lines[current.bodyLine]!;
  lines[current.bodyLine] = original.replace(TASK_BOX, (_all, open: string, _box: string, close: string) => `${open}${task.done ? " " : "x"}${close}`);
  await store.editItem(projectId, task.file, task.itemId, lines.join(""));
  return { status: "ok" };
}

const TASK_BOX = /^([ \t]*[-*+][ \t]+\[)([ xX])(\])/;
