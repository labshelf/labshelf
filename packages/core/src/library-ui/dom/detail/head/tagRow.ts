/**
 * Renders the tag row: chips that search their tag, an x that removes one, and a field that adds (Enter or a comma
 * adds, Backspace on an empty field takes back the last tag).
 */
import { escapeHtml, icon } from "../../../../ui/index.js";
import { changeTags } from "../../flows/index.js";
import type { UiContext } from "../../uiContext.js";

const TAG_OPTIONS_ID = "ls-tag-options";

function chip(tag: string): string {
  const name = `<button class="tag-name" type="button" data-action="searchTag" data-tag="${escapeHtml(tag)}" title="Show papers tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  const remove = `<button class="tag-x" type="button" data-action="removeTag" data-tag="${escapeHtml(tag)}" title="Remove tag" aria-label="Remove tag ${escapeHtml(tag)}">${icon("x")}</button>`;
  return `<span class="tag-chip">${name}${remove}</span>`;
}

/** Every tag in the library, once each (first spelling wins), A to Z: the field's suggestions. */
function libraryTags(ctx: UiContext): string[] {
  const seen = new Map<string, string>();
  for (const p of ctx.store.get().papers) for (const t of p.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function tagRowHtml(ctx: UiContext, tags: readonly string[]): string {
  const input = `<input class="tag-input" list="${TAG_OPTIONS_ID}" placeholder="${tags.length ? "+ Tag" : "+ Add tag"}" title="Type a tag and press Enter; commas add several" spellcheck="false" autocomplete="off" aria-label="Add tag"/>` +
    `<datalist id="${TAG_OPTIONS_ID}">${libraryTags(ctx).map((t) => `<option value="${escapeHtml(t)}"></option>`).join("")}</datalist>`;
  return `<div class="tag-row">${tags.map(chip).join("")}${input}</div>`;
}

/** Handles a key in the tag field; `ids` are the papers the row edits, `tags` the ones it shows. */
export function onTagKey(ctx: UiContext, e: KeyboardEvent, input: HTMLInputElement, ids: string[], tags: readonly string[]): void {
  if (e.key === "Enter") {
    const add = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    input.value = "";
    changeTags(ctx, ids, add, []);
    e.preventDefault();
  } else if (e.key === "Escape") {
    input.value = "";
    ctx.focusList();
    e.preventDefault();
  } else if (e.key === "Backspace" && !input.value && ids.length === 1 && tags.length) {
    changeTags(ctx, ids, [], [tags[tags.length - 1]!]);
    e.preventDefault();
  }
}

/** A comma typed into the field adds what came before it. */
export function onTagInput(ctx: UiContext, input: HTMLInputElement, ids: string[]): void {
  if (!input.value.includes(",")) return;
  const parts = input.value.split(",");
  input.value = parts.pop() ?? "";
  changeTags(ctx, ids, parts.map((s) => s.trim()).filter(Boolean), []);
}
