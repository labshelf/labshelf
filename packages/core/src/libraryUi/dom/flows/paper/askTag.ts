// Asks for tags in a prompt and adds them to the given papers.
import { inputBox } from "../../../../ui/dom/index.js";
import type { UiContext } from "../../uiContext.js";
import { changeTags, splitTags } from "./paperCommands.js";

export async function promptAddTags(ctx: UiContext, ids: readonly string[]): Promise<void> {
  const text = await inputBox({
    title: ids.length > 1 ? `Tag ${ids.length} papers` : "Add tag",
    prompt: "Tag; commas add several",
    placeholder: "e.g. to-read",
  });
  if (text) changeTags(ctx, ids, splitTags(text), []);
}
