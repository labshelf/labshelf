// Opens the editor page on a project's files in a new browser tab.
import { editorPagePath } from "../../editor";
import { bx } from "../../platform";

export async function openEditorInTab(projectId: string): Promise<void> {
  await bx.tabs.create({ url: bx.runtime.getURL(editorPagePath(projectId)) });
}
