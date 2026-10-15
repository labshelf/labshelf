/** Completes Tab input in overlay prompts: filesystem paths in the add prompt, existing tags in the tag prompts. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { expandHome } from "../../../platform/index.js";
import { textInput } from "../../textInput.js";
import type { PromptOverlay } from "../../overlays.js";
import type { App } from "../app.js";

export function looksLikePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("~") || value.startsWith(".");
}

// Tab completion: paths in the add prompt, tags in the tag prompts.
export async function complete(app: App, prompt: PromptOverlay): Promise<void> {
  if (prompt.purpose === "add") {
    const { completed, candidates } = await completePath(prompt.input.value);
    prompt.input = textInput(completed);
    prompt.completions = candidates;
  } else if (prompt.purpose === "tags" || prompt.purpose === "tagsBatch") {
    completeTag(app, prompt);
  }
  app.render();
}

function completeTag(app: App, prompt: PromptOverlay): void {
  const value = prompt.input.value;
  const sep = prompt.purpose === "tags" ? value.lastIndexOf(",") : value.lastIndexOf(" ");
  const head = value.slice(0, sep + 1);
  const rawWord = value.slice(sep + 1).trimStart();
  const sign = prompt.purpose === "tagsBatch" && /^[+-]/.test(rawWord) ? rawWord[0]! : "";
  const word = rawWord.slice(sign.length).toLowerCase();
  const tags = app.ctx.store.tagCounts().map((t) => t.tag).filter((t) => t.toLowerCase().startsWith(word));
  if (tags.length === 1) {
    const glue = prompt.purpose === "tags" && head ? " " : "";
    prompt.input = textInput(`${head}${glue}${sign}${tags[0]}${prompt.purpose === "tags" ? ", " : " "}`);
    prompt.completions = [];
  } else {
    prompt.completions = tags.slice(0, 8);
  }
}

/**
 * Completes a filesystem path for the add prompt (folders and PDFs only).
 * @returns the completed text and the other candidates
 */
export async function completePath(value: string): Promise<{ completed: string; candidates: string[] }> {
  const expanded = expandHome(value);
  const dir = expanded.endsWith("/") ? expanded : path.dirname(expanded || ".");
  const prefix = expanded.endsWith("/") ? "" : path.basename(expanded);
  let names: Array<{ name: string; dir: boolean }>;
  try {
    names = (await fs.readdir(dir || ".", { withFileTypes: true }))
      .filter((d) => d.name.startsWith(prefix) && (!d.name.startsWith(".") || prefix.startsWith(".")))
      .filter((d) => d.isDirectory() || d.name.toLowerCase().endsWith(".pdf"))
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return { completed: value, candidates: [] };
  }
  if (!names.length) { return { completed: value, candidates: [] }; }
  const base = value.slice(0, value.length - prefix.length);
  if (names.length === 1) {
    const only = names[0]!;
    return { completed: base + only.name + (only.dir ? "/" : ""), candidates: [] };
  }
  let common = names[0]!.name;
  for (const { name } of names) {
    while (!name.startsWith(common)) { common = common.slice(0, -1); }
  }
  return { completed: base + common, candidates: names.map((n) => n.name + (n.dir ? "/" : "")) };
}
