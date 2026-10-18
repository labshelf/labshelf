// Asks the title of a new project and, for a blank one, its format, with the core quick input.
import { inputBox, quickPick } from "@labshelf/core/dom";

export function askProjectTitle(defaultTitle: string): Promise<string | undefined> {
  return inputBox({
    title: "New project", prompt: "Project title", value: defaultTitle,
    validate: (value) => (value.trim() === "" ? "Enter a title." : undefined),
  }).then((title) => title?.trim());
}

export async function askBlankProject(): Promise<{ title: string; format: "latex" | "typst" } | undefined> {
  const title = await askProjectTitle("");
  if (!title) return undefined;
  const format = await quickPick([{ label: "LaTeX", value: "latex" as const }, { label: "Typst", value: "typst" as const }], { title: "Format of the new project" });
  return format === undefined ? undefined : { title, format };
}
