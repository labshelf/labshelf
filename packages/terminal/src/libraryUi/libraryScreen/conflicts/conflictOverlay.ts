// Opens the :conflicts overlay: pick a conflict copy, then how to resolve it.
import * as path from "node:path";

import { describeContentConflict, type ConflictCopy, type ConflictResolution } from "@labshelf/core";

import { textInput } from "../../textInput.js";
import type { PickerItem } from "../../overlays.js";
import type { App } from "../app.js";
import { conflictChoices, conflictItems } from "./conflictItems.js";

export function openConflicts(app: App): void {
  const copies = app.ctx.conflicts.copies;
  if (!copies.length) {
    app.taskStatus.notify("No conflicts");
    return;
  }
  const items = conflictItems(copies, (id) => app.ctx.store.snapshot.papers.get(id)?.record.title);
  openPicker(app, "Resolve a conflict", items, (item) => openChoices(app, copies[Number(item.id)]!));
}

function openChoices(app: App, copy: ConflictCopy): void {
  const choices = conflictChoices(copy);
  const title = copy.match && copy.match !== "name" ? describeContentConflict(copy) : `Resolve ${path.basename(copy.original)}`;
  openPicker(app, title, choices, (choice) => {
    if (choice.id === "mergeMyself") {
      openPicker(app, "Merge Myself", [copy.original, copy.copy].map((file) => ({ id: file, label: file })), () => undefined);
      return;
    }
    void app.taskStatus.task("conflicts", "Resolving", () => resolve(app, copy, choice.id as ConflictResolution));
  });
}

function openPicker(app: App, title: string, items: PickerItem[], onPick: (item: PickerItem) => void): void {
  app.overlay = { kind: "picker", title, input: textInput(), items, filtered: items, index: 0, onPick };
}

async function resolve(app: App, copy: ConflictCopy, resolution: ConflictResolution): Promise<void> {
  await app.ctx.resolveConflict(copy, resolution);
  await app.ctx.rescanConflicts();
  await app.ctx.store.reload();
  app.taskStatus.notify(`Resolved ${path.basename(copy.original)}`);
}
