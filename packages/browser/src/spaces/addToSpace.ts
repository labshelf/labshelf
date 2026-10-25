// Adds library paper references to the Space chosen in the browser page.
import { type ILogger, type SpaceStore } from "@labshelf/core";
import { askInputBox, pickQuickEntry } from "@labshelf/core/dom";

export async function addToSpace(
  store: SpaceStore, ids: string[], notice: (kind: "ok", text: string) => void, log: ILogger,
): Promise<void> {
  const choices = store.list().flatMap((result) => result.state === "ready" ? [{ label: result.space.name, value: result.space.id }] : []);
  const choice = await pickQuickEntry<string | { create: true }>([...choices, { label: "New Space…", value: { create: true } }], { title: "Add to Space" });
  if (choice === undefined) return;
  let id: string;
  if (typeof choice === "string") id = choice;
  else {
    const name = await askInputBox({ title: "New Space", validate: (value) => value.trim() ? null : "Enter a Space name" });
    if (name === undefined) return;
    id = await store.createSpace(name);
  }
  await store.addPapers(id, ids);
  void log.log("INFO", "spaces", "Added papers to Space", { spaceId: id, paperIds: ids });
  notice("ok", `Added ${ids.length === 1 ? "paper" : "papers"} to Space`);
}
