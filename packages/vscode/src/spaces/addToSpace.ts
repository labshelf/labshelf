// Adds selected paper references to a Space chosen through the host picker.
import * as vscode from "vscode";
import { placeOfSpace } from "@labshelf/core";
import type { SpacesService } from "./view.js";

export async function addToSpace(service: SpacesService, ids: string[]): Promise<boolean> {
  const current = service.current();
  if (!current || !ids.length) { return false; }
  const choices: (vscode.QuickPickItem & { id?: string })[] = current.store.list().flatMap(result =>
    result.state === "ready" && !result.readOnlyReason && placeOfSpace(result.space) === "spaces" ? [{ label: result.space.name, id: result.space.id }] : []);
  choices.push({ label: "New Space…" });
  const choice = await vscode.window.showQuickPick(choices, { placeHolder: "Add papers to Space" });
  if (!choice) { return false; }
  if (service.current() !== current) { throw new Error("The library changed while choosing a Space"); }
  const id = choice.id ?? await service.createSpace();
  if (!id) { return false; }
  if (service.current() !== current) { throw new Error("The library changed while choosing a Space"); }
  await current.store.addPapers(id, ids);
  return true;
}
