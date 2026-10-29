// Orders the "Send to…" choices both hosts show: live recent project notes first, then each project's other notes and a new-note entry.
import type { ProjectNoteEntry } from "./projectNotesStore.js";
import type { SendTarget } from "./sendTo.js";

export type { SendTarget };

export type SendTargetChoice =
  | { kind: "target"; target: SendTarget; label: string; description: string; recent: boolean }
  | { kind: "newNote"; projectId: string; label: string; description: string };

interface ProjectChoices { projectId: string; name: string; notes: readonly ProjectNoteEntry[] }

const NEW_NOTE_LABEL = "New note…";

function noteChoice(project: ProjectChoices, note: ProjectNoteEntry, recent: boolean): SendTargetChoice {
  return {
    kind: "target",
    target: { kind: "projectNote", projectId: project.projectId, path: note.path },
    label: note.title,
    description: project.name,
    recent,
  };
}

/**
 * Orders the Send to choices; spaces are not listed because no Space note writer exists yet.
 * @returns recent project notes still present (recent order), then per project its other notes and a "New note…" entry.
 */
export function deriveSendTargetChoices(recent: readonly SendTarget[], projects: readonly ProjectChoices[]): SendTargetChoice[] {
  const choices: SendTargetChoice[] = [];
  const listed = new Set<string>();
  const keyOf = (projectId: string, path: string): string => JSON.stringify([projectId, path]);
  for (const target of recent) {
    if (target.kind !== "projectNote") { continue; }
    const key = keyOf(target.projectId, target.path);
    if (listed.has(key)) { continue; }
    const project = projects.find((entry) => entry.projectId === target.projectId);
    const note = project?.notes.find((entry) => entry.path === target.path);
    if (project === undefined || note === undefined) { continue; }
    listed.add(key);
    choices.push(noteChoice(project, note, true));
  }
  for (const project of projects) {
    for (const note of project.notes) {
      if (listed.has(keyOf(project.projectId, note.path))) { continue; }
      choices.push(noteChoice(project, note, false));
    }
    choices.push({ kind: "newNote", projectId: project.projectId, label: NEW_NOTE_LABEL, description: project.name });
  }
  return choices;
}
